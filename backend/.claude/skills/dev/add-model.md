---
name: add-model
description: Adiciona um novo modelo ao seletor do frontend. Recebe model ID e label como argumentos.
---

# Adicionar Modelo

Adicionar nova opcao de modelo ao seletor do frontend.

## Argumentos
O usuario deve informar:
- **model_id**: ID do modelo (ex: `claude-sonnet-4-6`)
- **label**: Nome exibido no seletor (ex: `Claude Sonnet 4.6`)

## Passos

1. **Validar que o model ID funciona**
   ```bash
   cd backend && node -e "
   const { query } = require('@anthropic-ai/claude-code');
   (async () => {
     try {
       for await (const msg of query({ prompt: 'oi', options: { maxTurns: 1, model: 'MODEL_ID', permissionMode: 'bypassPermissions' } })) {
         if (msg.type === 'result') console.log(msg.is_error ? 'INVALIDO' : 'VALIDO');
       }
     } catch(e) { console.error('INVALIDO:', e.message); }
   })();
   "
   ```
   Substituir MODEL_ID pelo id informado. Se INVALIDO, avisar o usuario e nao prosseguir.

2. **Adicionar ao seletor** em `frontend/src/App.tsx`
   Procurar o bloco de `<option>` dentro do select de modelo e adicionar:
   ```tsx
   <option value="MODEL_ID">LABEL</option>
   ```

3. **Verificar** que o frontend recompila sem erros.

## Modelos conhecidos (abril 2026)
- `claude-opus-4-6` — Claude Opus 4.6
- `claude-sonnet-4-6` — Claude Sonnet 4.6
- `claude-haiku-4-5` — Claude Haiku 4.5
