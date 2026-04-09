---
name: fix-model-404
description: Diagnostica e corrige quando o modelo retorna erro 404. Exatamente o bug que tivemos com claude-sonnet-4-5-20250514.
---

# Fix Model 404

Quando o chat retorna "Claude Code process exited with code 1" causado por model ID invalido.

## Diagnostico

1. **Ver qual modelo esta configurado no frontend**
   ```bash
   grep -n "model:" frontend/src/App.tsx | grep -v "//" | head -5
   ```

2. **Testar o modelo**
   ```bash
   cd backend && node -e "
   const { query } = require('@anthropic-ai/claude-code');
   (async () => {
     try {
       for await (const msg of query({ prompt: 'oi', options: { maxTurns: 1, model: 'MODELO_AQUI', permissionMode: 'bypassPermissions', stderr: (d) => { if (d.includes('404')) console.error('>>> 404:', d); } } })) {
         if (msg.type === 'result') console.log(msg.is_error ? 'INVALIDO: ' + msg.result : 'OK');
       }
     } catch(e) { console.error('ERRO:', e.message); }
   })();
   "
   ```

3. **Verificar nos logs**
   ```bash
   grep -i "404\|not_found\|model" /tmp/chat-backend.log | tail -5
   ```

## Fix

1. Trocar o model ID no default do frontend em `App.tsx` (~linha 469)
2. Atualizar as opcoes do select (~linha 1349)
3. Frontend recompila sozinho (hot-reload)
4. NAO precisa reiniciar o backend

## Model IDs validos (abril 2026)
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`

## Historico
- `claude-sonnet-4-5-20250514` — retorna 404 (ID antigo/invalido)
- IDs com data completa podem parar de funcionar — preferir IDs curtos
