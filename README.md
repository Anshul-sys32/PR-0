<div align="center">

# ⚡ PR-0

### One Workspace. Multiple AIs. Limitless Possibilities.

**An extensible, multi-model AI coding agent built to help turn ideas into working software.**

Plan tasks, work with project files, run development tools, and supervise AI-assisted workflows from one developer workspace.

**Built for developers who want more than a chat window.**

[Overview](#-what-is-pr-0) · [Features](#-capabilities) · [Quick start](#-quick-start) · [Architecture](#-architecture) · [Roadmap](#-roadmap)

</div>

---

> [!NOTE]
> **PR-0 is an early-stage project under active development.** Capabilities vary by provider and tool configuration. This README distinguishes implemented foundations from planned work; it does not imply that every feature described here is production-ready. Verify provider connectivity, terminal behavior, browser workflows, and security boundaries in your own environment before relying on them.

## 🧠 What Is PR-0?

AI development often means jumping between model providers, editors, terminals, documentation, browser tools, and task trackers. PR-0 explores bringing those parts of the workflow into one extensible workspace.

The core idea is straightforward: an AI coding agent should do more than generate a code snippet. It should help a developer:

1. Understand the requested outcome and relevant project context.
2. Break complex work into manageable steps.
3. Use configured models and tools for the task.
4. Inspect files and propose or make changes within configured boundaries.
5. Run available checks and inspect the results.
6. Explain what changed, what succeeded, and what still needs attention.

PR-0 is designed around **model choice, visible execution, developer control, and modularity**. Its long-term direction is a workspace in which different models and tools can contribute to a single, inspectable development workflow.

## ✨ Capabilities

The project is evolving. The table below describes the current product direction and avoids treating every planned capability as complete.

| Area | Direction |
|---|---|
| **Agent workspace** | A unified place to prompt the agent, inspect progress, and follow task execution. |
| **Model providers** | OpenAI, Anthropic, Gemini, OpenRouter, and local Ollama use one adapter interface; free-only and local-only policies and explicit fallback allowlists are available. Mock remains test-only. |
| **Task planning** | Break requests into steps and make execution progress easier to follow. |
| **Project tools** | Work with files and workspace context through controlled tools. |
| **Terminal workflows** | Run development commands and inspect output where supported and enabled. |
| **Approvals** | Keep sensitive operations visible and subject to the applicable approval controls. |
| **Browser and research tools** | Support documentation research and browser-assisted workflows as integrations mature. |
| **Verification** | Use type checks, automated tests, builds, and browser tests to validate changes. |

### Multi-model development

PR-0 keeps provider integrations modular rather than tying the product to a single model. Implemented adapters include OpenAI, Google Gemini, Anthropic Claude, OpenRouter, and local Ollama. Ollama is selected by default and can run without a separate hosted-provider key; the UI checks whether the local service is reachable and shows installed model tags. OpenRouter uses its documented API and dynamic tool-compatible model catalog, with `openrouter/free` available for free-only routing. Mock remains available only as a deterministic test adapter and never calls a real model.

PR-0 does not automate consumer AI chat websites. A review of ChatGPT, Claude, Gemini Apps, Copilot, Perplexity, and Duck.ai found no permitted browser-chat integration route; some sites allow limited guest use, but their terms or machine-readable site instructions prohibit or fail to authorize automated prompting and response retrieval. See [`docs/PROVIDERS.md`](docs/PROVIDERS.md) for the official evidence and limits.

Hosted API providers can receive task and conversation context, project-memory notes, and model-requested workspace tool results. PR-0 requires per-run consent before hosted inference; model-catalog lookup sends no project content. Local-only mode suppresses the catalog and blocks hosted inference/fallback. Free-only mode blocks paid/unverified models; fallback is off unless explicitly allowed, policy-checked, and does not replay a successful tool call. Credential-like data is blocked before forwarding. OpenRouter free models have variable availability and documented rate limits, not unlimited service. Gemini Developer API's free tier is separate from Gemini Apps and applies only to selected models under changing quotas and data-use terms.

Different models may be better suited to different tasks—for example, frontend design, backend reasoning, debugging, or research. Provider routing and specialized agent roles should be treated as configurable capabilities, not a guarantee that every role or provider is available in every build.

### A workspace for real development tasks

The intended workflow connects conversation and task planning with project context and developer tools. Over time, the workspace is intended to make it easier to review proposed changes, understand tool activity, inspect command output, and see which checks have actually passed.

### UI/UX direction

The interface is being designed as a focused developer workspace rather than a collection of unrelated tools:

- Group navigation into clear, task-oriented sections.
- Keep the main agent conversation and composer central.
- Make task progress and tool activity visible.
- Give files, diffs, terminal output, and approvals clear places in the workflow.
- Provide useful loading, empty, success, and error states.
- Support keyboard navigation, accessible controls, and smaller screens.

See [`UI-UX.md`](UI-UX.md) for the detailed interface specification. The specification describes the target experience; it should not be interpreted as proof that every screen or interaction has already been implemented.

## 🚀 Quick Start

### Prerequisites

- **Node.js 22 or later**
- **npm**
- **Git** for Git-related workspace features
- **Playwright Chromium** for browser automation and browser tests
- Optional: credentials for a supported AI provider, or a compatible local model service

The local Ollama provider is selected by default. To use it, install Ollama, start its local service, and pull a model, for example:

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

Refresh provider status in Task options. PR-0 will report installed model tags and requires a selected model before planning or execution. The Mock provider can be selected explicitly for deterministic UI/test flows; it does not generate real feature work. Hosted provider use still depends on credentials, model availability, and configuration.

### 1. Clone the repository

```bash
git clone https://github.com/Anshul-sys32/PR-0.git
cd PR-0
```

### 2. Install dependencies

```bash
npm install
```

Install the Playwright browser used by browser automation and browser tests:

```bash
npx playwright install chromium
```

### 3. Configure the environment

Review the example environment file and the provider documentation before configuring credentials:

```bash
cp .env.example .env
```

Set only the values needed for your setup. Keep API keys, passwords, session secrets, and other credentials out of source control. Do not commit your `.env` file.

### 4. Start the development environment

```bash
npm run dev
```

The current repository configuration uses these default local endpoints:

- **Web UI:** `http://localhost:5173`
- **API server:** `http://127.0.0.1:5000`

If your environment or configuration changes these ports, use the values printed by the development servers.

### Useful development commands

Run these from the repository root:

```bash
# Start the web app and API together
npm run dev

# Type-check the workspaces
npm run typecheck

# Run unit/integration tests
npm test

# Run browser tests
npm run test:browser

# Build the workspaces
npm run build

# Initialize the server database
npm run db:init
```

A command being available does not mean every test or integration has already been verified on every machine. Review the output and report failures rather than assuming a check passed.

For additional setup details, consult the repository documentation:

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- [`docs/PROVIDERS.md`](docs/PROVIDERS.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)

## 🏗️ Architecture

PR-0 uses a workspace-based TypeScript codebase. At a high level, the system separates the web interface, API server, agent orchestration, model integrations, shared contracts, and tool execution.

```text
┌───────────────────────────────────────────────┐
│                 PR-0 Web UI                   │
│       Workspace · Conversation · Activity     │
└────────────────────────┬──────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────┐
│                   API Server                  │
│        HTTP API · Configuration · Storage     │
└────────────────────────┬──────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────┐
│               Agent Core / Planner            │
│       Task state · Tool selection · Flow      │
└───────────────┬─────────────────┬─────────────┘
                │                 │
                ▼                 ▼
┌────────────────────────┐  ┌───────────────────┐
│     Model Gateway      │  │   Tool Runtime    │
│ Provider adapters      │  │ Files · Terminal  │
│ Model configuration    │  │ Browser · Tools   │
└────────────────────────┘  └───────────────────┘
                │                 │
                └────────┬────────┘
                         ▼
┌───────────────────────────────────────────────┐
│        Shared Types · Persistence · Tests     │
└───────────────────────────────────────────────┘
```

This is a conceptual overview of the main boundaries, not a claim that every integration is complete or production-hardened.

### Repository layout

```text
apps/
  server/          API server
  web/             Web interface
packages/
  shared/          Shared types and contracts
  model-gateway/   Model/provider integration layer
  tool-runtime/    Tools and controlled execution
  agent-core/      Agent planning and orchestration
docs/              Development, provider, and security documentation
prompts/            Agent prompts and instructions
tests/              Automated tests
UI-UX.md            Target UI/UX specification
IMPLEMENTATION_PLAN.md
                   Implementation status and planned work
```

Names and responsibilities may evolve as the project changes; inspect the current source tree for the latest implementation.

## 🔐 Security and trust

An agent that can access project files or run commands needs stronger safeguards than a normal chat interface. PR-0's design priorities include:

- **Least privilege:** provide tools only with the access they need.
- **Visible execution:** make tool actions and command output inspectable.
- **Approval for sensitive actions:** preserve confirmation and permission boundaries.
- **Workspace boundaries:** constrain filesystem access where supported.
- **Credential hygiene:** keep secrets out of source code, logs, and commits.
- **Untrusted input handling:** treat repository files and external web content as data, not trusted instructions.
- **Failure transparency:** report provider and tool errors rather than presenting failed work as successful.

These are design priorities, not a blanket security certification. Before using PR-0 on valuable data or sensitive repositories, review [`docs/SECURITY.md`](docs/SECURITY.md), understand which controls are implemented, and test the relevant boundaries. Do not expose the development server or enable unrestricted command execution on an untrusted network.

## 🧭 Development Status and Roadmap

PR-0 is being developed incrementally. Use [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) as the source of truth for the current implementation checklist and known gaps.

### Current focus

- Improve the clarity and usability of the main workspace.
- Replace overloaded navigation with task-oriented sections.
- Make loading, empty, error, and success states meaningful.
- Improve visibility into task execution, tool activity, and results.
- Keep the UI aligned with real backend behavior instead of adding decorative controls that do nothing.
- Verify provider connectivity, terminal execution, approval handling, and browser workflows.
- Expand automated coverage and keep documentation consistent with the code.

### Longer-term direction

- More robust provider configuration and model selection.
- Reliable task planning, execution history, and recovery.
- Clear file-change and diff review workflows.
- Better browser-assisted research and development workflows.
- Specialized agent roles and controlled delegation.
- More comprehensive accessibility, security, and integration testing.

Roadmap items are not release promises. Priorities may change as the codebase and test coverage evolve.

## 🧪 Testing and verification

The repository provides scripts for type checking, tests, builds, and browser tests. Run the checks relevant to your change before submitting it:

```bash
npm run typecheck
npm test
npm run build
npm run test:browser
```

When reporting results, distinguish checks that passed from checks that were skipped, blocked by missing credentials, or not run. Mock-provider tests are useful for deterministic development, but they do not replace verifying a real provider or real host-level tool execution.

## 🤝 Contributing

Issues, bug reports, UI/UX feedback, and focused pull requests are welcome as the project matures.

Helpful contributions include:

- Provider adapters and configuration improvements
- Agent planning and execution reliability
- Tool permissions and security boundaries
- UI interactions, accessibility, and responsive behavior
- Tests, bug reproductions, and developer documentation

For substantial changes, first review the existing implementation plan and related documentation. Prefer small, testable changes that preserve existing API contracts and safety restrictions. Avoid introducing mock behavior that makes an unfinished integration appear functional.

## 📚 Project Documents

| Document | Purpose |
|---|---|
| [`UI-UX.md`](UI-UX.md) | Target interface, interaction patterns, accessibility, and implementation phases |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Implementation checklist and progress |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Local development setup |
| [`docs/PROVIDERS.md`](docs/PROVIDERS.md) | Model provider configuration |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security boundaries and operational guidance |

## 📜 License

Check the repository for a `LICENSE` file and its terms before redistributing or reusing this project. Do not assume a license that is not explicitly included.

---

<div align="center">

### ⚡ PR-0

**One goal. Multiple models. A smarter way to build.**

*An open-ended project in active development.*

</div>
