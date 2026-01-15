# ContextOS

**ContextOS** 是一个将「上下文规划（context planning）」视为一等公民、且可审计的上下文编排系统。
它的设计目标是：通过捕获结构化产物（如计划、差异、漂移、治理决策以及模型调用记录），让每一轮交互都具备**可复现性**，并且允许实验在**不修改主运行态状态**的前提下安全进行。

---

## 这个仓库提供了什么

* **上下文编排流水线（Orchestration Pipeline）**
  用于组装上下文、规划 token / 成本预算，并通过适配器执行 LLM 调用。

* **治理与采用控制（Governance & Adoption Controls）**
  用于追踪人类决策，并在关键节点施加策略门控（policy gates）。

* **实验沙箱（Experiment Sandbox）**
  支持多视图组合运行，并导出只读的 CanvasBundle 产物。

* **以产物为核心的透明性（Artifact-first Transparency）**
  每一个决策都会生成明确的产物，可被回放、对比和审计。

---

## 快速开始

> 本仓库使用 TypeScript 与 Node.js。构建产物会输出到 `dist/` 目录。

```bash
npm install
npm run build
```

---

## 运行 CLI

CLI 支持编排运行、实验流程以及治理报告。

### 基础运行（Mock LLM）

```bash
node dist/apps/cli/src/run.js run --message "Hello ContextOS"
```

---

### DeepSeek 实验运行

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 在 `.env` 中设置你的模型提供方与 API Key：

```env
LLM_PROVIDER=deepseek
LLM_MODE=experiment
DEEPSEEK_API_KEY=sk-...
```

3. 使用 DeepSeek 以实验模式运行一次对话：

```bash
node dist/apps/cli/src/run.js run --provider deepseek --mode experiment --message "Hello"
```

模型调用产物（包括 `ModelCallRecord`）会被持久化到：

```text
data/experiment_model_calls/
```

---

## 实验工作流（PR7B）

创建实验规格、执行实验，并导出 Canvas bundle：

```bash
node dist/apps/cli/src/run.js experiment spec create \
  --message "Test" \
  --mode multi_view \
  --views debug@v1,plan@v1 \
  --planner a,b

node dist/apps/cli/src/run.js experiment run --spec <spec_id>
node dist/apps/cli/src/run.js experiment export --id <experiment_id> --format canvas
```

---

## 只读 API（用于 Canvas 消费）

```bash
npm run build
node dist/apps/api/src/server.js
```

可用接口：

* `GET /experiments/:id/bundle`
* `GET /artifacts/:ref`

这些接口**仅提供只读访问**，用于前端或其他系统安全消费实验产物。

---

## 关键目录结构

* `services/`
  编排、治理、实验以及逻辑引擎核心实现。

* `apps/cli/`
  CLI 入口，用于运行对话和实验。

* `apps/api/`
  面向 UI 的只读产物 API。

* `packages/shared-types/`
  核心领域类型与契约定义。

---

## 设计哲学

ContextOS **不是一个记忆型 OS**。
它是一个专注于以下核心目标的上下文编排层：

* 有预算意识的上下文规划（Budgeted Context Planning）
* 可控视图的执行（View-controlled Execution）
* 完全透明、以产物为中心的系统设计（Artifact-first Transparency）

系统允许实验存在，但**实验绝不能在无声的情况下修改生产运行态**。
