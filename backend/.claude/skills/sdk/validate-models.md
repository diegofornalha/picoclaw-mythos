---
name: validate-models
description: Testa quais model IDs configurados no frontend estao funcionando na API. Previne erro 404.
---

# Validar Modelos

Testa cada modelo configurado no seletor do frontend para confirmar que a API aceita.

## Passos

1. **Listar modelos configurados no frontend**
   ```bash
   grep -o 'value="[^"]*"' frontend/src/App.tsx | grep -i claude | sed 's/value="//;s/"//'
   ```

2. **Testar cada modelo**
   Para cada model ID encontrado, rodar:
   ```bash
   cd backend && node -e "
   const { query } = require('@anthropic-ai/claude-code');
   const model = 'MODEL_ID';
   (async () => {
     try {
       for await (const msg of query({ prompt: 'oi', options: { maxTurns: 1, model, permissionMode: 'bypassPermissions' } })) {
         if (msg.type === 'result') {
           if (msg.is_error) console.log('❌', model, '— INVALIDO:', msg.result?.substring(0,100));
           else console.log('✅', model, '— OK');
         }
       }
     } catch(e) { console.log('❌', model, '— ERRO:', e.message.substring(0,100)); }
   })();
   "
   ```

3. **Reportar** quais funcionam e quais nao. Se algum falhou, sugerir remover do seletor ou substituir.

## Modelos conhecidos (abril 2026)
- `claude-opus-4-6` — Opus 4.6
- `claude-sonnet-4-6` — Sonnet 4.6
- `claude-haiku-4-5` — Haiku 4.5
