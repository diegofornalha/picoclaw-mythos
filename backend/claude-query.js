/**
 * claude-query.js — Wrapper para o SDK v2 do Claude Code
 *
 * O SDK v2 (@anthropic-ai/claude-code) não exporta query() programaticamente.
 * Este módulo spawna o CLI e emite os mesmos eventos que a query() do SDK v1.
 */
const { spawn } = require('child_process');
const path = require('path');

const CLI_PATH = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

// Usa Node 22 se disponível (v1 cli.js crasha no Node 25)
const NODE_BIN = process.env.CLAUDE_NODE_BIN || 'node';

async function* query({ prompt, options = {} }) {
  const args = [
    CLI_PATH,
    '--output-format', 'stream-json',
    '--verbose',
    '--print',
  ];

  if (options.maxTurns) args.push('--max-turns', String(options.maxTurns));
  if (options.permissionMode) args.push('--permission-mode', options.permissionMode);
  if (options.model) args.push('--model', options.model);
  if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt);
  if (options.allowedTools?.length) {
    for (const tool of options.allowedTools) {
      args.push('--allowedTools', tool);
    }
  }
  if (options.includePartialMessages) args.push('--include-partial-messages');

  // Prompt goes as the last argument
  args.push(prompt);

  const child = spawn(NODE_BIN, args, {
    env: { ...process.env, PATH: process.env.PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: options.cwd || process.cwd(),
  });

  // Handle abort
  if (options.abortController) {
    options.abortController.signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
    });
  }

  // Stderr handler
  if (options.stderr) {
    child.stderr.on('data', (data) => options.stderr(data.toString()));
  }

  // Parse NDJSON from stdout
  let buffer = '';
  const lineQueue = [];
  let resolve;
  let done = false;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.trim()) {
        try {
          lineQueue.push(JSON.parse(line));
          if (resolve) { resolve(); resolve = null; }
        } catch (e) {
          // skip malformed JSON
        }
      }
    }
  });

  child.on('close', (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        lineQueue.push(JSON.parse(buffer));
      } catch (e) {}
    }
    if (code !== 0 && lineQueue.length === 0) {
      lineQueue.push({
        type: 'result',
        subtype: 'error',
        is_error: true,
        error: `Claude Code process exited with code ${code}`,
        result: `Claude Code process exited with code ${code}`,
      });
    }
    done = true;
    if (resolve) { resolve(); resolve = null; }
  });

  // Yield messages as they arrive
  while (true) {
    while (lineQueue.length > 0) {
      yield lineQueue.shift();
    }
    if (done) break;
    await new Promise(r => { resolve = r; });
  }
}

module.exports = { query };
