---
name: check-ports
description: Diagnostica conflitos de porta 3000 (frontend) e 8080 (backend). Mostra o que esta ocupando cada porta.
---

# Verificar Portas

## Passos

1. **Porta 8080 (backend)**
   ```bash
   lsof -i :8080 -P 2>/dev/null | head -5
   if [ $? -ne 0 ] || [ -z "$(lsof -i :8080 -P 2>/dev/null)" ]; then
     echo "Porta 8080: LIVRE — backend nao esta rodando"
   fi
   ```

2. **Porta 3000 (frontend)**
   ```bash
   lsof -i :3000 -P 2>/dev/null | head -5
   if [ $? -ne 0 ] || [ -z "$(lsof -i :3000 -P 2>/dev/null)" ]; then
     echo "Porta 3000: LIVRE — frontend nao esta rodando"
   fi
   ```

3. **Se porta ocupada por outro processo**: mostrar PID e comando
   ```bash
   lsof -i :8080 -i :3000 -P 2>/dev/null | awk 'NR>1 {print $2, $1, $9}'
   ```

4. **Para liberar porta** (se necessario, confirmar com usuario antes):
   ```bash
   kill $(lsof -ti :PORTA)
   ```

## Portas do projeto
- 3000: React dev server (frontend)
- 8080: Express + Socket.IO (backend)
