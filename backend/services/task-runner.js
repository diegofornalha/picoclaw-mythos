const { query } = require('@anthropic-ai/claude-code');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const memory = require('./memory-store');

const TASKS_FILE = path.join(__dirname, '..', 'data', 'tasks.json');
const SKILLS_ROOT = path.join(__dirname, '..', '.claude', 'skills');
const DEFAULT_WORKSPACE = process.env.PICOCLAW_WORKSPACE || path.join(__dirname, '..');

// ── Skill expansion: /nome → conteúdo do arquivo .md ──
function expandSkill(prompt, workspace) {
  if (!prompt.startsWith('/')) return prompt;
  const skillName = prompt.slice(1).trim().split(/\s/)[0];
  const rest = prompt.slice(1 + skillName.length).trim();

  const searchRoots = [
    workspace ? path.join(workspace, '.claude', 'skills') : null,
    SKILLS_ROOT,
  ].filter(Boolean);

  for (const root of searchRoots) {
    try {
      const entries = fs.readdirSync(root, { recursive: true });
      for (const entry of entries) {
        const base = path.basename(entry, '.md');
        if (base === skillName) {
          const content = fs.readFileSync(path.join(root, entry), 'utf8');
          const body = content.replace(/^---[\s\S]*?---\n/, '').trim();
          return rest ? `${body}\n\n---\nContexto adicional: ${rest}` : body;
        }
      }
    } catch { /* diretório não existe */ }
  }

  console.warn(`⚠️ Skill não encontrada: ${skillName}`);
  return prompt;
}

// ── Formata memory store para system prompt ──
function _buildMemoryContext(ctx) {
  const sections = [];

  if (ctx.debts && ctx.debts.length > 0) {
    const open = ctx.debts.filter(d => d.status === 'open');
    if (open.length > 0) {
      sections.push(
        '## Débitos Técnicos Conhecidos\n' +
        open.map(d => `- [${d.severity}] ${d.desc} (${d.file})`).join('\n')
      );
    }
  }

  if (ctx.findings && ctx.findings.length > 0) {
    const recent = ctx.findings.slice(-10);
    sections.push(
      '## Achados Recentes\n' +
      recent.map(f => `- ${f.summary || JSON.stringify(f)}`).join('\n')
    );
  }

  if (ctx.changelog && ctx.changelog.length > 0) {
    const recent = ctx.changelog.slice(-5);
    sections.push(
      '## Últimas Mudanças Aplicadas\n' +
      recent.map(c => `- ${c.desc || JSON.stringify(c)}`).join('\n')
    );
  }

  return sections.join('\n\n');
}

// ── Estado em memória ──
const tasks = new Map();
const queue = [];
let running = false;
let _io = null;          // Socket.IO ref (setado pelo startAutonomous)
let _cooldownUntil = 0;  // timestamp até quando pausar (rate limit)

// ── Persistência leve ──

function _load() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readJsonSync(TASKS_FILE);
      for (const t of data) tasks.set(t.id, t);
      console.log(`📋 Task Runner: loaded ${tasks.size} tasks`);
    }
  } catch (e) {
    console.warn('⚠️ task-runner: failed to load tasks:', e.message);
  }
}

function _save() {
  try {
    fs.ensureDirSync(path.dirname(TASKS_FILE));
    const recent = Array.from(tasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200);
    fs.writeJsonSync(TASKS_FILE, recent, { spaces: 2 });
  } catch (e) {
    console.error('❌ task-runner: failed to save tasks:', e.message);
  }
}

_load();

// ── Rate limit detection ──

function _isRateLimitError(msg) {
  return msg.includes('usage limit') ||
    msg.includes('rate limit') ||
    msg.includes('Claude AI usage limit reached');
}

function _extractResetTimestamp(msg) {
  const match = msg.match(/limit reached\|(\d+)/);
  if (match) return parseInt(match[1]) * 1000;
  return Date.now() + 60 * 60 * 1000; // fallback: 1h
}

// ── Criar task ──

function createTask({ prompt, workspace, systemPrompt, maxTurns, model, tags, source }) {
  const id = uuidv4();
  const task = {
    id,
    prompt,
    workspace: workspace || DEFAULT_WORKSPACE,
    systemPrompt: systemPrompt || null,
    maxTurns: maxTurns || 10,
    model: model || process.env.DEFAULT_MODEL || null,
    tags: tags || [],
    source: source || 'api',
    status: 'queued',
    result: null,
    error: null,
    steps: [],
    cost: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  tasks.set(id, task);
  queue.push(id);
  _save();
  _drainQueue();
  return task;
}

function getTask(id) {
  return tasks.get(id) || null;
}

function listTasks({ status, source, limit = 50 } = {}) {
  let all = Array.from(tasks.values())
    .sort((a, b) => b.createdAt - a.createdAt);
  if (status) all = all.filter(t => t.status === status);
  if (source) all = all.filter(t => t.source === source);
  return all.slice(0, limit);
}

function cancelTask(id) {
  const task = tasks.get(id);
  if (!task) return false;
  if (task.status === 'queued') {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    task.status = 'cancelled';
    task.finishedAt = Date.now();
    _save();
    return true;
  }
  if (task._abortController) {
    task._abortController.abort();
    return true;
  }
  return false;
}

// ── Worker ──

async function _drainQueue() {
  if (running || queue.length === 0) return;

  // Cooldown ativo — não processa
  if (_cooldownUntil > Date.now()) {
    const waitMin = Math.ceil((_cooldownUntil - Date.now()) / 60000);
    console.log(`⏸️  Rate limit cooldown — ${waitMin}min restantes`);
    return;
  }

  running = true;

  while (queue.length > 0) {
    // Checar cooldown entre tasks
    if (_cooldownUntil > Date.now()) break;

    const taskId = queue.shift();
    const task = tasks.get(taskId);
    if (!task || task.status === 'cancelled') continue;

    await _runTask(task, _io);
  }

  running = false;
}

async function _runTask(task, io) {
  task.status = 'running';
  task.startedAt = Date.now();
  const abort = new AbortController();
  task._abortController = abort;
  _save();

  _emit(io, task.id, 'task_start', { taskId: task.id, prompt: task.prompt });
  console.log(`▶️  Task ${task.id} started: ${task.prompt.substring(0, 80)}`);

  try {
    const queryOptions = {
      maxTurns: task.maxTurns,
      permissionMode: 'acceptEdits',
      abortController: abort,
      cwd: task.workspace,
      model: task.model || process.env.MYTHOS_MODEL || 'claude-sonnet-4-6',
    };

    let fullPrompt = expandSkill(task.prompt, task.workspace);

    // Injeta contexto do memory store
    const ctx = memory.readMany(['findings', 'debts', 'changelog']);
    const memCtx = _buildMemoryContext(ctx);
    const sysBase = task.systemPrompt || '';
    const sysWithMem = [sysBase, memCtx].filter(Boolean).join('\n\n');
    if (sysWithMem) {
      fullPrompt = `<system>\n${sysWithMem}\n</system>\n\n${fullPrompt}`;
    }

    let lastAssistantText = '';

    for await (const msg of query({ prompt: fullPrompt, options: queryOptions })) {
      const step = { type: msg.type, timestamp: Date.now() };

      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            step.text = block.text;
            lastAssistantText = block.text;
          }
        }
      }

      if (msg.type === 'result') {
        if (typeof msg.result === 'string' && msg.result.trim()) {
          task.result = msg.result;
        } else if (Array.isArray(msg.result)) {
          task.result = msg.result
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n')
            .trim();
        } else if (msg.result && typeof msg.result === 'object' && msg.result.text) {
          task.result = msg.result.text;
        }
        if (!task.result && lastAssistantText) {
          task.result = lastAssistantText;
        }
        task.cost = msg.total_cost_usd || null;
        step.result = task.result;
        step.cost = task.cost;
      }

      task.steps.push(step);
      _emit(io, task.id, 'task_step', { taskId: task.id, step });
    }

    if (!task.result && lastAssistantText) {
      task.result = lastAssistantText;
    }

    task.status = abort.signal.aborted ? 'cancelled' : 'done';
  } catch (err) {
    // Rate limit → cooldown + requeue
    if (_isRateLimitError(err.message)) {
      _cooldownUntil = _extractResetTimestamp(err.message);
      const resetDate = new Date(_cooldownUntil);
      console.log(`⏸️  Rate limit hit — pausando até ${resetDate.toLocaleTimeString()}`);
      // Requeue: não marca como error, volta pra fila
      task.status = 'queued';
      task.startedAt = null;
      task.steps = [];
      queue.unshift(task.id);
    } else {
      task.status = 'error';
      task.error = err.message;
      _emit(io, task.id, 'task_error', { taskId: task.id, error: err.message });
      console.error(`❌ Task ${task.id} error:`, err.message);
    }
  }

  task.finishedAt = task.status === 'queued' ? null : Date.now();
  task._abortController = null;
  _save();

  if (task.status !== 'queued') {
    _emit(io, task.id, 'task_done', {
      taskId: task.id,
      status: task.status,
      result: task.result,
      cost: task.cost,
    });
    console.log(`✅ Task ${task.id} ${task.status} (${((task.finishedAt - task.startedAt) / 1000).toFixed(1)}s)`);
  }
}

function _emit(io, taskId, event, data) {
  if (io) io.emit(event, data);
}

// ── Modo autônomo ──

let autonomousTimer = null;

function startAutonomous(io, intervalMs) {
  if (autonomousTimer) return;
  _io = io; // Guarda ref do Socket.IO
  console.log(`🤖 Autonomous mode: ciclo a cada ${intervalMs / 60000}min`);
  _scheduleAutonomousTask();
  autonomousTimer = setInterval(() => {
    _scheduleAutonomousTask();
  }, intervalMs);
}

function stopAutonomous() {
  if (autonomousTimer) {
    clearInterval(autonomousTimer);
    autonomousTimer = null;
    console.log('🤖 Autonomous mode stopped');
  }
}

const LOGS_PATH = process.env.PICOCLAW_LOGS || '/Users/2a/.picoclaw/logs';
const AGENTS_PATH = process.env.CLAUDE_AGENTS_PATH || '/Users/2a/.claude/agents';

const SELF_MISSIONS = [
  '/self-review',
  '/analyze-logs',
  'Analise server.js e task-runner.js. Identifique: handlers sem try/catch, Maps sem limite, rotas mortas. Liste com severidade.',
  '/self-review',
  `Leia os logs em ${LOGS_PATH}/ e verifique se as skills cobrem os padrões de erro encontrados. Sugira novas skills se necessário.`,
  '/analyze-logs',
  `Verifique os agentes em ${AGENTS_PATH}/. Liste os mais relevantes para melhorar o picoclaw-mythos.`,
  'Leia data/memory/debts.json. Escolha o debt aberto de maior severidade. Corrija-o editando o arquivo indicado. Após corrigir, atualize debts.json mudando status para "resolved". Teste com node --check.',
  '/self-improve',
];

const PICOCLAW_MISSIONS = [
  'Analise pkg/providers/ do picoclaw. Identifique providers com padrões inconsistentes. Lista priorizada.',
  'Leia ROADMAP.md e compare com o código atual. Liste: implementado, parcial, pendente.',
  '/analyze-logs',
  `Leia os logs em ${LOGS_PATH}/ e sugira melhorias concretas no código Go para reduzir os erros encontrados.`,
];

let missionIndex = 0;
const TOTAL_MISSIONS = SELF_MISSIONS.length + PICOCLAW_MISSIONS.length;

function _scheduleAutonomousTask() {
  // Cooldown ativo — pula ciclo
  if (_cooldownUntil > Date.now()) {
    const waitMin = Math.ceil((_cooldownUntil - Date.now()) / 60000);
    console.log(`⏸️  [mission skip] Rate limit cooldown — ${waitMin}min restantes`);
    return;
  }

  const workspace = process.env.PICOCLAW_WORKSPACE || path.join(__dirname, '..');
  const goPath = process.env.PICOCLAW_GOPATH;
  let prompt, taskWorkspace, tags;

  if (missionIndex % 3 === 0 || !goPath || !require('fs').existsSync(goPath)) {
    prompt = SELF_MISSIONS[missionIndex % SELF_MISSIONS.length];
    taskWorkspace = workspace;
    tags = ['autonomous', 'self-review'];
  } else {
    prompt = PICOCLAW_MISSIONS[missionIndex % PICOCLAW_MISSIONS.length];
    taskWorkspace = goPath;
    tags = ['autonomous', 'picoclaw-analysis'];
  }

  missionIndex = (missionIndex + 1) % TOTAL_MISSIONS;

  console.log(`🤖 [mission ${missionIndex}] ${prompt.substring(0, 70)}`);
  createTask({
    prompt,
    workspace: taskWorkspace,
    tags,
    source: 'cron',
    maxTurns: 15,
  });
}

module.exports = {
  createTask,
  getTask,
  listTasks,
  cancelTask,
  startAutonomous,
  stopAutonomous,
  _drainQueue,
};
