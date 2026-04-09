---
name: fix-connection
description: Passo a passo para diagnosticar e corrigir quando o chat nao conecta. Problema mais comum do projeto.
---

# Fix Connection

Quando o chat mostra "Desconectado" ou mensagens nao chegam.

## Diagnostico

1. **Backend rodando?**
   ```bash
   pgrep -f "node server.js" && echo "SIM" || echo "NAO — precisa iniciar"
   ```

2. **Frontend rodando?**
   ```bash
   pgrep -f "craco start" && echo "SIM" || echo "NAO — rodar: cd frontend && npm start"
   ```

3. **Portas ocupadas?**
   ```bash
   lsof -i :8080 -P | head -3
   lsof -i :3000 -P | head -3
   ```

4. **Backend responde?**
   ```bash
   curl -s http://localhost:8080/health | head -1 || echo "NAO RESPONDE"
   ```

5. **WebSocket funciona?**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/socket.io/?EIO=4\&transport=polling
   ```
   Deve retornar 200. Se 404, o socket.io nao esta configurado.

6. **Proxy do frontend aponta certo?**
   ```bash
   cat frontend/src/setupProxy.js
   ```
   Deve apontar para localhost:8080.

7. **Erros no log?**
   ```bash
   grep -i "error\|ECONNREFUSED\|EADDRINUSE" /tmp/chat-backend.log | tail -10
   ```

## Fixes comuns

- **EADDRINUSE**: porta ocupada — `kill $(lsof -ti :8080)` e reiniciar
- **CORS error**: verificar configuracao CORS no server.js
- **Proxy error**: frontend nao encontra backend — verificar setupProxy.js
- **WebSocket timeout**: reiniciar backend e recarregar pagina
