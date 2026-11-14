# 🌿 TerraShift Git Branching Strategy (GitHub Flow)

We use **GitHub Flow (Trunk-Based Development)** so all 6 team members can ship fast without merge conflicts.
Every merge into `main` targeting `frontend/**` automatically deploys to Vercel via [`.github/workflows/deploy-vercel.yml`](../.github/workflows/deploy-vercel.yml), and the Ubuntu server pulls directly from `main`.

---

## 1. Branch Types & Naming

| Branch | Purpose | Lifetime |
| :--- | :--- | :--- |
| **`main`** | Always deployable production branch. **No direct pushes**—use PRs only. | Permanent |
| **`feat/<module>-<topic>`** | New features scoped to one module (e.g. `feat/frontend-leaflet-map`, `feat/layer1-ndvi`, `feat/main-auth`). | 1–4 hours |
| **`fix/<module>-<topic>`** | Bug fixes or hotfixes (e.g. `fix/agronomy-redis-timeout`). | < 1 hour |
| **`chore/<topic>`** | Infra, Docker, CI, or docs updates (e.g. `chore/update-readme`). | < 1 hour |

---

## 2. Conflict-Free Rules for All 6 Members

1. **Stay inside your module directory:** Only edit files in your assigned path (see [`.github/CODEOWNERS`](../.github/CODEOWNERS)).
2. **Coordinate shared contract changes:** Any PR touching [`docs/api-contract.md`](api-contract.md), [`docker-compose.yml`](../docker-compose.yml), or [`.env.example`](../.env.example) requires Lead approval and a quick heads-up in team chat.
3. **Always Squash & Merge:** Keeps `main` linear so any broken merge can be rolled back cleanly with `git revert <commit>`.
4. **Run local checks before opening a PR:**
   - `agronomy-engine`: `pytest`
   - `main-service`: `npm run typecheck`
   - `frontend`: `npm run typecheck`
5. **Demo-Day Code Freeze (2h before submission):** Stop merging `feat/*` branches into `main`; only `fix/*` hotfixes are allowed.

---

## 3. Teammate Workflow

```bash
# 1. Start from the latest main
git checkout main
git pull origin main

# 2. Create a scoped branch
git checkout -b feat/frontend-leaflet-draw

# 3. Make changes inside your module, test, and commit
git add frontend/
git commit -m "feat(frontend): add interactive Leaflet polygon draw"

# 4. Push and open a Pull Request -> main
git push -u origin feat/frontend-leaflet-draw
```

Open the PR on GitHub, get **1 approval**, and click **Squash and merge**.

---

## 4. Conventional Commit Prefixes

- `feat(<module>): ...` — new feature
- `fix(<module>): ...` — bug fix
- `docs: ...` — documentation only
- `chore: ...` — Docker, CI, dependencies, or tooling
