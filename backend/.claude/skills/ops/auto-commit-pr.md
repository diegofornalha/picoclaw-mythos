---
name: auto-commit-pr
description: Detecta mudanças em todos os repos relacionados ao picoclaw, cria commits e PRs. Sabe diferenciar repos próprios (push direto) de forks/upstream (fork + PR).
---

# Auto Commit & PR — Multi-Repo

Verifica mudanças em todos os repos relacionados e cria commits/PRs conforme o caso.

## Repos monitorados

| Repo | Path | Owner | Estratégia |
|------|------|-------|-----------|
| picoclaw-mythos | /Users/2a/.claude/batalha/picoclaw-mythos | diegofornalha | push direto + PR |
| picoclaw_docs | /Users/2a/.claude/batalha/picoclaw_docs | diegofornalha | push direto + PR |
| picoclaw | /Users/2a/.claude/batalha/picoclaw | sipeed (upstream) | fork + PR upstream |
| whatsmeow | /Users/2a/.claude/whatsmeow | tulir (upstream) | somente pull, sem push |

## 1. Verificar mudanças em cada repo

```bash
for repo in /Users/2a/.claude/batalha/picoclaw-mythos /Users/2a/.claude/batalha/picoclaw_docs /Users/2a/.claude/batalha/picoclaw /Users/2a/.claude/whatsmeow; do
  echo "=== $(basename $repo) ==="
  cd "$repo" && git status --porcelain 2>/dev/null | head -10
  echo ""
done
```

Se nenhum repo tiver mudanças, reportar e parar.

## 2. Para cada repo COM mudanças

### Repos próprios (picoclaw-mythos, picoclaw_docs)

```bash
cd <repo>
git diff --stat
BRANCH="mythos/auto-$(date +%Y%m%d-%H%M)"
git checkout -b "$BRANCH"
git add -A
git commit -m "<mensagem descritiva baseada no diff>

Aplicado pelo ciclo autônomo do picoclaw-mythos
Co-Authored-By: picoclaw-mythos <noreply@picoclaw.io>"
git push -u origin "$BRANCH"
gh pr create --title "<titulo>" --body "## Mudanças
<lista>

Aplicado automaticamente pelo picoclaw-mythos."
git checkout main
```

### Repo upstream (picoclaw — sipeed/picoclaw)

Antes de modificar, verificar se existe fork do usuário:
```bash
gh repo view diegofornalha/picoclaw 2>/dev/null && echo "fork existe" || echo "precisa forkar"
```

Se não tiver fork: `gh repo fork sipeed/picoclaw --clone=false`

Criar branch no fork:
```bash
cd /Users/2a/.claude/batalha/picoclaw
git remote add myfork https://github.com/diegofornalha/picoclaw.git 2>/dev/null
BRANCH="mythos/auto-$(date +%Y%m%d-%H%M)"
git checkout -b "$BRANCH"
git add -A
git commit -m "<mensagem>"
git push myfork "$BRANCH"
gh pr create --repo sipeed/picoclaw --head "diegofornalha:$BRANCH" --title "<titulo>" --body "<corpo>"
git checkout main
```

### whatsmeow — SOMENTE LEITURA

NÃO commitar nem criar PR no whatsmeow. Se houver mudanças locais, reportar e sugerir que sejam descartadas ou movidas para o picoclaw.

## 3. Reportar

Para cada repo processado:
- Branch criada
- URL do PR (se criado)
- Arquivos modificados
- Se whatsmeow tem mudanças locais pendentes
