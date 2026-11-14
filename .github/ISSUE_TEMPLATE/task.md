---
name: "🛠️ Hackathon Task"
about: "Track a unit of work for the TerraShift Space Apps build"
title: "[MODULE] Short task description"
labels: ["task"]
assignees: []
---

## 📦 Module
<!-- Tick exactly one -->
- [ ] `frontend` (Next.js / UI / map)
- [ ] `main-service` (Express API / auth / Mongo / Gemini)
- [ ] `agronomy-engine` – NASA client / cache
- [ ] `agronomy-engine` – Layer 1 risk (regression / time-series)
- [ ] `agronomy-engine` – Layer 2 rotation (genetic algorithm)
- [ ] `infra` (docker-compose / nginx / CI / docs)

## 📝 Description
<!-- What needs to be built or fixed, and why. Link NASA datasets / docs if relevant. -->

## ✅ Acceptance Criteria
- [ ] 
- [ ] 
- [ ] Tests / manual verification steps documented in the PR

## 🔌 API Contract Impact
- [ ] **No** change to `docs/api-contract.md`
- [ ] **Yes** — contract change (requires Lead review + notify affected owners)

## 👤 Owner & Estimate
- **Owner:** @
- **Estimate:** ⏱️ `S (<2h)` / `M (2–4h)` / `L (4h+)`
- **Blocked by:** #

## 🏁 Definition of Done
- [ ] Code merged to `main` via PR (1 approval)
- [ ] Only files inside the owned module were changed (or contract change approved)
- [ ] `docker compose up --build` still works
- [ ] Demo-able in the UI or via `curl`
