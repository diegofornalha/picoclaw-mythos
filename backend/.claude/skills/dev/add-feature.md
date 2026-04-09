---
name: add-feature
description: Checklist de onde mexer para adicionar uma feature nova ao chat app (backend + frontend + types).
---

# Adicionar Feature

Guia de onde mexer para adicionar funcionalidade nova ao projeto.

## Arquivos principais

### Backend (server.js)
- **Socket event**: adicionar handler em `io.on('connection')` (~linha 724)
- **REST endpoint**: adicionar rota Express antes do `server.listen`
- **Helper function**: adicionar no topo do arquivo, junto com `extractTextContent`, `getStepMessage`, etc.

### Frontend
- **Types**: `frontend/src/types/index.ts` — adicionar interfaces/types novos
- **UI + logica**: `frontend/src/App.tsx` — componente principal
- **Socket listener**: dentro do `useEffect` que cria o socket (~linha 560)
- **Settings**: state `settings` (~linha 464) e painel Config (~linha 1330)
- **UI Settings**: state `uiSettings` e painel Interface

### Configuracao
- **Backend port**: `backend/.env` (PORT=8080)
- **Frontend proxy**: `frontend/src/setupProxy.js`

## Checklist para nova feature
1. Definir types em `types/index.ts`
2. Adicionar socket event ou REST endpoint no backend
3. Adicionar listener no frontend
4. Adicionar UI (botao, painel, etc)
5. Testar com /test-chat ou pelo browser
6. Verificar que nao quebrou nada: `cd frontend && npx tsc --noEmit`
