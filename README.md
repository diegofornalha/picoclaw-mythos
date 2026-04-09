# picoclaw-mythos

Orquestrador de tarefas complexas para o [picoclaw](https://github.com/sipeed/picoclaw). Roda localmente como backend HTTP + WebSocket, expondo o poder do Claude Opus (hoje) e futuramente modelos Mythos-class — sem que o picoclaw precise de API key.

## Arquitetura

```
picoclaw (Go)
    │  tarefas simples → processa localmente (Anthropic SDK)
    │  tarefas complexas ↓
    ▼
picoclaw-mythos (Node.js)
    │  usa @anthropic-ai/claude-code SDK (query())
    │  acessa skills, ferramentas, MCP servers
    │  autenticação via claude login (sem API key)
    ▼
Claude Opus / Mythos
```

O picoclaw é leve e rápido para o cotidiano. O picoclaw-mythos entra quando a tarefa exige raciocínio profundo, uso de ferramentas, execução de skills ou múltiplos turnos autônomos.

## Pré-requisitos

- Node.js 18+
- [Claude Code CLI](https://github.com/anthropics/claude-code) instalado e autenticado (`claude login`)
- picoclaw rodando (opcional — o backend funciona standalone)

## Instalação

```bash
cd backend
npm install
```

## Configuração

Edite `backend/.env`:

```env
PORT=3456
NODE_ENV=development
SOCKET_IO_CORS_ORIGIN=http://localhost:5173

# Modelo padrão (usa autenticação do claude login)
# CLAUDE_SDK_ENABLED=true
```

Nenhuma `ANTHROPIC_API_KEY` necessária — usa as credenciais do `claude login`.

## Rodando

```bash
cd backend
npm start          # produção
npm run dev        # desenvolvimento com nodemon
```

Servidor disponível em `http://localhost:3456`.

## Skills

O orquestrador acessa automaticamente as skills do diretório de trabalho. Para usar as skills do picoclaw:

```bash
# Rodar o backend a partir do diretório do picoclaw
cd /Users/2a/.picoclaw
node /caminho/para/picoclaw-mythos/backend/server.js
```

Ou criar um symlink:

```bash
ln -s /Users/2a/.picoclaw/.claude backend/.claude
```

Skills disponíveis em `/Users/2a/.picoclaw/.claude/skills/`:
- `enviar-mensagem` — envia mensagem via WhatsApp
- `enviar-midia` — envia mídia salva
- `listar-grupos` — lista grupos do WhatsApp
- `ativar-assinante` — ativa assinante e notifica
- `remover-assinante` — desativa assinante
- *(e outras)*

## API

### WebSocket (Socket.IO)

Conecte em `ws://localhost:3456`.

**Enviar mensagem:**
```js
socket.emit('send_message', {
  message: 'Analise este código e sugira melhorias',
  sessionId: 'minha-sessao',        // opcional
  systemPrompt: 'Você é um revisor de código sênior',  // opcional
  maxTurns: 10,
  customOptions: {
    model: 'claude-opus-4-6',
    maxThinkingTokens: 8000
  }
});
```

**Eventos recebidos:**
| Evento | Descrição |
|--------|-----------|
| `typing_start` | Claude começou a processar |
| `message_stream` | Chunk de texto em tempo real |
| `processing_step` | Passo intermediário (tool use, thinking, etc.) |
| `message_complete` | Resposta final completa |
| `typing_end` | Processamento encerrado |
| `error` | Erro durante processamento |

**Cancelar:**
```js
socket.emit('cancel_message');
```

### REST

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/health` | Status do servidor |
| `GET /api/sessions` | Listar sessões ativas |
| `GET /api/sessions/:id` | Detalhes de uma sessão |
| `DELETE /api/sessions/:id` | Remover sessão |
| `POST /api/upload` | Upload de arquivo para análise |
| `POST /api/export` | Exportar conversa |

### Integração com picoclaw (Go)

No picoclaw, use o protocolo `motor` no `config.json` para rotear para este backend:

```json
{
  "model": "motor/claude-opus-4-6",
  "api_base": "http://localhost:3456"
}
```

Ou via HTTP direto para tarefas pontuais — envie um `send_message` via WebSocket e aguarde `message_complete`.

## Capacidades

Comparado ao uso direto do Anthropic SDK no picoclaw:

| Capacidade | picoclaw direto | picoclaw-mythos |
|------------|:-:|:-:|
| Resposta simples | ✅ | ✅ |
| Streaming de tokens | ✅ | ✅ |
| Uso de ferramentas (bash, arquivos) | ❌ | ✅ |
| Execução de skills | ❌ | ✅ |
| Múltiplos turnos autônomos | ❌ | ✅ |
| Raciocínio estendido (thinking) | ❌ | ✅ |
| Upload e análise de arquivos | ❌ | ✅ |
| Histórico de sessão persistente | ✅ | ✅ |

## Roadmap

- [ ] Endpoint REST síncrono (`POST /api/query`) para integração simples
- [ ] Provider `motor` nativo no picoclaw Go
- [ ] Suporte a Claude Mythos quando disponível
- [ ] Roteamento automático picoclaw → mythos baseado em complexidade da tarefa
- [ ] Interface web para monitoramento de sessões

## Sobre o nome

*Mythos* refere-se à próxima geração de modelos Claude com capacidades de raciocínio significativamente superiores. Este backend foi projetado para ser o ponto de entrada quando o picoclaw precisar de poder de modelo maior — hoje com Opus, amanhã com Mythos.
