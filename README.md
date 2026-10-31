# Project PR-0

Project PR-0 is a local-first AI development workspace. The current vertical slice provides a Fastify API, SQLite persistence, a mock provider, four provider adapters, a bounded model/tool loop, workspace-scoped file reads and approved writes, terminal sessions, audit records, and a responsive React dashboard.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

Open `http://127.0.0.1:5173`. Create a project pointing at a workspace directory, submit a task, and run it using the deterministic mock model. The API health check is at `http://127.0.0.1:5000/health`.

## Checks

```bash
npm test
npm run typecheck
npm run build
```

## Provider status

The deterministic mock provider needs no credentials. OpenAI Responses, Anthropic Messages, Gemini `generateContent`, and Ollama `/api/chat` adapters are implemented. Select a provider in the composer; cloud providers require server-side keys and each provider requires a configured or entered model identifier. Ollama uses `http://127.0.0.1:11434` by default. Credentials stay server-side. Real cloud connectivity remains unverified without credentials and no paid calls are made automatically.

## Security model

The backend is loopback-bound by default. API inputs are validated with Zod. File reads and writes are scoped to a registered project root and reject absolute paths, traversal, symlink escapes, and sensitive credential files in model context. Supervised writes and terminal commands require persisted approval. Tasks, usage, approvals, pending operations, terminal sessions, and audit actions are persisted locally. Browser automation, web research, Git operations, and multi-agent scheduling are not implemented yet.

See [architecture documentation](docs/ARCHITECTURE.md), [development notes](docs/DEVELOPMENT.md), and [security notes](docs/SECURITY.md).
