---
name: audit-deps
description: Roda npm audit no frontend e backend juntos. Reporta vulnerabilidades e dependencias desatualizadas.
---

# Auditar Dependencias

## Passos

1. **Backend**
   ```bash
   cd backend && echo "=== BACKEND ===" && npm audit 2>&1 | tail -15 && echo "" && npm outdated 2>/dev/null
   ```

2. **Frontend**
   ```bash
   cd frontend && echo "=== FRONTEND ===" && npm audit 2>&1 | tail -15 && echo "" && npm outdated 2>/dev/null
   ```

3. **Fix automatico** (se usuario autorizar)
   ```bash
   cd backend && npm audit fix
   cd frontend && npm audit fix
   ```

## Reportar
- Total de vulnerabilidades (critical/high/moderate/low) por pasta
- Pacotes desatualizados
- Se npm audit fix resolve ou precisa de --force
