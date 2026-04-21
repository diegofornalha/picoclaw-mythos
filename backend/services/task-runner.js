const { query, isThrottled } = require('../claude-query');
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
    } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`❌ skill expansion error in ${root}: ${err.message}`);
        }
      }
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
let _retryTimer = null;  // timer para retomar fila após cooldown

// ── Persistência leve ──

function _load() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readJsonSync(TASKS_FILE);
      let orphanCount = 0;
      for (const t of data) {
        tasks.set(t.id, t);
        if (t.status === 'queued') {
          queue.push(t.id);
        } else if (t.status === 'running') {
          // Task órfã: estava running quando o backend reiniciou
          console.log(`♻️  Orphan detected: ${t.id} — requeueing`);
          t.status = 'queued';
          t.startedAt = null;
          t.retryCount = (t.retryCount || 0) + 1;
          queue.push(t.id);
          orphanCount++;
        }
      }
      // Limpar tasks terminadas com mais de 24h
      const DAY_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      let cleanedCount = 0;
      for (const [id, t] of tasks) {
        if (['done', 'error', 'cancelled'].includes(t.status) && t.createdAt && (now - t.createdAt) > DAY_MS) {
          tasks.delete(id);
          cleanedCount++;
        }
      }

      if (orphanCount > 0 || cleanedCount > 0) {
        if (orphanCount > 0) console.log(`♻️  ${orphanCount} orphaned task(s) requeued`);
        if (cleanedCount > 0) console.log(`🧹 ${cleanedCount} old task(s) cleaned up`);
        _save();
      }
      console.log(`📋 Task Runner: loaded ${tasks.size} tasks (${queue.length} queued, ${orphanCount} recovered, ${cleanedCount} cleaned)`);
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
      .slice(0, 200)
      .map(({ _abortController, _timeoutId, ...safe }) => safe);
    fs.writeJsonSync(TASKS_FILE, recent, { spaces: 2 });
  } catch (e) {
    console.error('❌ task-runner: failed to save tasks:', e.message);
  }
}

_load();
// Drenar fila após carregar tasks (inclui órfãs recuperadas)
setTimeout(() => _drainQueue(), 5000);

// ── Rate limit detection ──

function _isRateLimitError(msg) {
  const lower = msg.toLowerCase();
  return lower.includes('usage limit') ||
    lower.includes('rate limit') ||
    lower.includes('limit reached') ||
    lower.includes('claude ai usage limit');
}

function _extractResetTimestamp(msg) {
  const match = msg.match(/limit reached\|(\d+)/);
  if (match) return parseInt(match[1]) * 1000;
  return Date.now() + 60 * 60 * 1000; // fallback: 1h
}

// ── Agendar retry após cooldown ──

function _scheduleRetry() {
  if (_retryTimer) clearTimeout(_retryTimer);
  const waitMs = Math.max(_cooldownUntil - Date.now(), 60000); // mínimo 1min
  console.log(`⏰ Retry agendado para daqui ${Math.ceil(waitMs / 60000)}min`);
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    console.log(`🔄 Cooldown expirou — retomando fila (${queue.length} tasks)`);
    _drainQueue();
  }, waitMs);
}

// ── Extrair progresso dos steps pra montar contexto de retomada ──

function _buildResumeContext(task) {
  if (!task.steps || task.steps.length === 0) return null;

  const completed = [];
  const lastTexts = [];

  for (const step of task.steps) {
    if (step.type === 'tool_use' && step.toolName) {
      completed.push(`- ${step.toolName}: ${step.inputSummary || step.toolName}`);
    }
    if (step.type === 'assistant' && step.text) {
      lastTexts.push(step.text);
    }
  }

  if (completed.length === 0 && lastTexts.length === 0) return null;

  const parts = [];
  parts.push(`<resume-context>`);
  parts.push(`Esta tarefa foi INTERROMPIDA por rate limit e está sendo retomada.`);
  parts.push(`Retry #${task.retryCount || 1} — NÃO repita passos já concluídos.`);
  parts.push(``);

  if (completed.length > 0) {
    parts.push(`Ferramentas já executadas antes da interrupção:`);
    // Limitar a últimos 20 pra não poluir contexto
    for (const c of completed.slice(-20)) parts.push(c);
    parts.push(``);
  }

  if (lastTexts.length > 0) {
    const lastThought = lastTexts[lastTexts.length - 1];
    if (lastThought.length > 0) {
      parts.push(`Último raciocínio antes da pausa:`);
      parts.push(lastThought.substring(0, 500));
      parts.push(``);
    }
  }

  parts.push(`IMPORTANTE: Verifique o estado atual do filesystem antes de agir.`);
  parts.push(`Se arquivos já existem (imagens baixadas, traduzidas, etc), pule esses passos.`);
  parts.push(`</resume-context>`);

  return parts.join('\n');
}

const MAX_RETRIES = 5;

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
    retryCount: 0,
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

function findActiveByTag(tag) {
  for (const task of tasks.values()) {
    if ((task.status === 'running' || task.status === 'queued') && task.tags && task.tags.includes(tag)) {
      return task;
    }
  }
  return null;
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

function deleteTask(id) {
  const task = tasks.get(id);
  if (!task) return { deleted: false, reason: 'not_found' };
  if (task.status === 'running' || task.status === 'queued') {
    return { deleted: false, reason: 'still_active' };
  }
  tasks.delete(id);
  _save();
  return { deleted: true };
}

function purgeDoneTasks() {
  let count = 0;
  for (const [id, task] of tasks.entries()) {
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'error') {
      tasks.delete(id);
      count++;
    }
  }
  if (count > 0) _save();
  return count;
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

    // Throttle: memória alta ou max processos atingido
    if (isThrottled()) {
      console.log('⏸️  Throttled — retrying in 30s');
      running = false;
      setTimeout(() => _drainQueue(), 30000);
      return;
    }

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

  // Auto-abort após 15 minutos
  const TASK_TIMEOUT_MS = 15 * 60 * 1000;
  const timeoutId = setTimeout(() => {
    console.warn(`⏰ Task ${task.id} auto-aborted after ${TASK_TIMEOUT_MS / 60000}min timeout`);
    abort.abort();
  }, TASK_TIMEOUT_MS);
  task._timeoutId = timeoutId;

  _save();

  _emit(io, task.id, 'task_start', { taskId: task.id, prompt: task.prompt });
  console.log(`▶️  Task ${task.id} started: ${task.prompt.substring(0, 80)}`);

  try {
    const queryOptions = {
      maxTurns: task.maxTurns,
      permissionMode: (task.tags?.includes('auto-pr') || task.tags?.includes('instagram')) ? 'bypassPermissions' : 'acceptEdits',
      abortController: abort,
      cwd: task.workspace,
      model: task.model || process.env.MYTHOS_MODEL || 'claude-opus-4-6',
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

    // Se é retry, injetar contexto de retomada
    const resumeCtx = _buildResumeContext(task);
    if (resumeCtx) {
      fullPrompt = `${resumeCtx}\n\n${fullPrompt}`;
      console.log(`🔄 Task ${task.id} retomando (retry #${task.retryCount || 1}, ${task.steps.length} steps anteriores)`);
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

      // Capturar info de tool_use pra contexto de retomada
      if (msg.type === 'tool_use') {
        step.toolName = msg.name;
        step.inputSummary = msg.input?.command?.substring(0, 120)
          || msg.input?.file_path?.split('/').pop()
          || msg.input?.pattern
          || msg.name;
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

      const MAX_STEPS = 200;
      if (task.steps.length >= MAX_STEPS) {
        task.steps = task.steps.slice(-Math.floor(MAX_STEPS / 2));
      }
      task.steps.push(step);
      _emit(io, task.id, 'task_step', { taskId: task.id, step });
    }

    if (!task.result && lastAssistantText) {
      task.result = lastAssistantText;
    }

    task.status = abort.signal.aborted ? 'cancelled' : 'done';
  } catch (err) {
    const errMsg = err.message || '';
    // Rate limit → cooldown + requeue + agendar retry
    if (_isRateLimitError(errMsg) ||
        (errMsg.includes('exited with code 1') && task.steps.length === 0)) {
      // exit code 1 sem steps = provável rate limit (não chegou a executar)
      _cooldownUntil = _isRateLimitError(errMsg)
        ? _extractResetTimestamp(errMsg)
        : Date.now() + 5 * 60 * 1000; // 5min fallback — tenta rápido
      const resetDate = new Date(_cooldownUntil);
      task.retryCount = (task.retryCount || 0) + 1;
      console.log(`⏸️  Rate limit hit (retry #${task.retryCount}) — pausando até ${resetDate.toLocaleTimeString()}`);

      if (task.retryCount >= MAX_RETRIES) {
        task.status = 'error';
        task.error = `Rate limit: max retries (${MAX_RETRIES}) exceeded`;
        _emit(io, task.id, 'task_error', { taskId: task.id, error: task.error });
        console.error(`❌ Task ${task.id} desistiu após ${MAX_RETRIES} retries`);
      } else {
        // Requeue: preserva steps (progresso), volta pra fila
        task.status = 'queued';
        task.startedAt = null;
        // NÃO zera steps — _buildResumeContext usa pra retomar de onde parou
        queue.unshift(task.id);
        _scheduleRetry();
      }
    } else {
      task.status = 'error';
      task.error = errMsg;
      _emit(io, task.id, 'task_error', { taskId: task.id, error: errMsg });
      console.error(`❌ Task ${task.id} error:`, errMsg);
    }
  }

  task.finishedAt = task.status === 'queued' ? null : Date.now();
  if (task._timeoutId) clearTimeout(task._timeoutId);
  task._timeoutId = null;
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

// ── Inicialização ──

function init(io) {
  _io = io;
}

module.exports = {
  init,
  createTask,
  getTask,
  listTasks,
  cancelTask,
  deleteTask,
  purgeDoneTasks,
  findActiveByTag,
  _drainQueue,
};
