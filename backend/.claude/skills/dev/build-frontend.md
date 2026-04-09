---
name: build-frontend
description: Build de producao do React frontend com verificacao de TypeScript.
---

# Build Frontend

## Passos

1. Verificar TypeScript: `cd frontend && npx tsc --noEmit`
2. Build: `cd frontend && npm run build`
3. Verificar: `du -sh frontend/build/`
