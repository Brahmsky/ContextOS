# ContextOS

ContextOS is a context orchestration system that treats **context planning** as a first-class, auditable pipeline. It is designed to make every turn reproducible by capturing structured artifacts (plans, diffs, drift, governance decisions, and model-call records) so experiments can run safely without mutating the main runtime state.

## What this repository provides

- **Orchestration pipeline** that assembles context, plans budgets, and executes LLM calls through adapters.
- **Governance and adoption controls** to track human decisions and apply policy gates.
- **Experiment sandbox** to run multi-view compositions and export read-only CanvasBundle artifacts.
- **Artifact-first transparency** so every decision can be replayed, compared, and audited.

## Quick start

> This repo uses TypeScript and Node.js. Build output is written to `dist/`.

```bash
npm install
npm run build
```

## Running the CLI

The CLI supports orchestration runs, experiments, and governance reports.

### Basic run (mock LLM)

```bash
node dist/apps/cli/src/run.js run --message "Hello ContextOS"
```

### DeepSeek experiment run

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Set your provider and key in `.env`:

```env
LLM_PROVIDER=deepseek
LLM_MODE=experiment
DEEPSEEK_API_KEY=sk-...
```

3. Run a turn with DeepSeek in experiment mode:

```bash
node dist/apps/cli/src/run.js run --provider deepseek --mode experiment --message "Hello"
```

Artifacts (including `ModelCallRecord`) are persisted under `data/experiment_model_calls/`.

## Experiment workflow (PR7B)

Create a spec, run it, and export a Canvas bundle:

```bash
node dist/apps/cli/src/run.js experiment spec create \
  --message "Test" \
  --mode multi_view \
  --views debug@v1,plan@v1 \
  --planner a,b

node dist/apps/cli/src/run.js experiment run --spec <spec_id>
node dist/apps/cli/src/run.js experiment export --id <experiment_id> --format canvas
```

## Read-only API (Canvas consumption)

```bash
npm run build
node dist/apps/api/src/server.js
```

Endpoints:

- `GET /experiments/:id/bundle`
- `GET /artifacts/:ref`

## Key directories

- `services/` — orchestration, governance, experiments, and logic engine.
- `apps/cli/` — CLI entrypoint for running turns and experiments.
- `apps/api/` — read-only artifact API for UI consumption.
- `packages/shared-types/` — core domain types and contracts.

## Philosophy

ContextOS is not a memory OS. It is an orchestration layer that prioritizes **budgeted context planning**, **view-controlled execution**, and **transparent artifacts**. Experiments are allowed, but they cannot silently mutate production state.
