# Project PR-0 implementation plan

## Current milestone: Phase 5 dependency-aware execution

- [x] Inspect empty repository and runtime.
- [x] Establish npm workspaces and strict TypeScript configuration.
- [x] Install dependencies and verify the workspace builds. `npm install`, type checking, tests, and production builds now complete successfully.
- [x] Implement SQLite persistence, API, mock gateway, agent loop, and UI.
- [x] Add workspace-scoped filesystem reads and approval-gated writes with persisted pending operations.
- [x] Add approval-gated, workspace-scoped terminal sessions with no-shell spawning, output limits, timeouts, stop support, audit records, and integration coverage.
- [x] Add the first official provider adapter (OpenAI Responses API), configurable server-side credentials/model id, normalized tool-call and usage handling, and deterministic adapter tests.
- [x] Add Anthropic, Gemini, and Ollama adapters with provider-specific request/response normalization, explicit provider selection, and server-only credentials.
- [x] Add deterministic unit and integration tests and execute them.
- [x] Add provider selection to the UI and make model tool calls pass through a bounded, schema-validated agent loop. The only model tool currently exposed is workspace-safe `filesystem.read`.
- [x] Propagate task cancellation through in-flight provider requests and prevent cancelled runs from overwriting their terminal state. Verified with deterministic unit and API integration tests.
- [x] Load the shared system prompt and each role's prompt file through agent-core; verify all nine role prompts and assert role-specific prompt dispatch through the API.
- [x] Persist structured task execution results in SQLite and return them with task history so the UI restores reports after reload.
- [x] Add validated role selection when creating a task and expose a Stop control for active UI executions.
- [x] Add dependency-aware task creation and execution gating: dependents wait until prerequisites complete and become blocked if prerequisites fail or are cancelled.
- [x] Generate task plans through a validated provider-independent route, persist plan/task graphs atomically, create deterministic mock plans, and reject malformed/cyclic model output before any tasks are saved.
- [x] Add the composer Plan workflow action; generated tasks are shown in the persisted queue and remain under explicit user control before execution.
- [x] Add a persisted plan-run endpoint that schedules ready tasks in bounded parallel batches, waits for prerequisites, and allows failed prerequisites to block descendants.
- [x] Verify plan generation, malformed/cyclic plan rejection, and dependency-aware concurrency with deterministic API integration tests.
- [x] Recursively propagate prerequisite completion and failure through nested dependency chains.
- [x] Persist conversations across turns, list and switch between threads in the UI, and append completion/failure/cancellation messages to chat history.
- [x] Include prior persisted user/assistant turns in follow-up model requests.
- [x] Enforce `MAX_CONCURRENT_TASKS` server-side and apply `MAX_TOOL_STEPS_PER_TASK` to the agent loop, with deterministic concurrency-limit and cancellation coverage.
- [x] Apply validated `MAX_RETRIES_PER_TASK` to transient provider/network failures with bounded backoff; fail deterministic authentication/configuration errors without retry.
- [x] Add a prerequisite selector to the composer and reject cross-project dependency references before persisting a message.
- [x] Add workspace-scoped file listing and text search APIs and agent tools with result caps, ignored generated directories, sensitive-file exclusion, and symlink exclusion; add a navigable explorer/search and file preview to the UI.
- [x] Add a project-scoped pending approval feed and UI approve/reject actions; verify approval summaries do not expose stored operation payloads.
- [x] Replace the static terminal panel with an allowlisted command form, approval queue integration, live output polling, and stop controls.
- [x] Add read-only Git status and staged/unstaged numstat endpoints plus a sidebar summary using fixed no-shell arguments, bounded output, a timeout, and disposable-repository integration coverage. Patch content is not returned.
- [x] Add structured project memory CRUD with secret-pattern rejection, a sidebar editor, and bounded lexical retrieval of relevant notes as explicitly untrusted model context.
- [x] Add project-level usage aggregates and a dashboard showing requests, token counts, estimated costs, and unknown-cost records.
- [x] Add separate manual TODO persistence and CRUD, including priorities, acceptance criteria, and status changes; verify agent task execution does not alter manual TODO state.
- [x] Recover persisted running tasks and terminal sessions after server restart with explicit failed/interrupted records and a deterministic close/reopen integration test.
- [x] Reuse the React root during Vite HMR to avoid duplicate-root errors after reloads.
- [x] Remove deprecated TypeScript `baseUrl`, make paths aliases relative, set explicit workspace roots, and add Vite client types for CSS imports.
- [x] Document setup, architecture, and security constraints.

## Verification recorded in this resume

- `npm run typecheck`: passed across shared, model-gateway, tool-runtime, agent-core, server, and web workspaces.
- `npm test`: passed, 5 test files and 39 tests after plan-run UI and retry-accounting changes.
- `npx vitest run tests/integration/api.test.ts`: passed, 13 tests including plan persistence, cycle rejection, bounded scheduling, retry persistence, and run conflicts.
- `npm run build`: passed across all packages; Vite reports a non-blocking recommendation to switch React plugins for Rolldown performance.
- `git diff --check`: passed.
- The Git status and numstat integration test passed against a disposable repository initialized during the test.
- The strict web side-effect import check (`npx tsc --noEmit -p apps/web/tsconfig.json --noUncheckedSideEffectImports`) passed.
- Browser smoke check confirmed the UI connects to the API; no project was created in the development database.
- `get_errors` reported no diagnostics in the touched TypeScript, prompt, and test files after the latest full verification.
- Focused agent-loop and API integration checks passed (19 tests), covering persisted retry counts across SQLite reopen and duplicate active task/plan run conflicts.
- Real cloud provider connectivity, browser automation, public web research, and sandbox-restricted bind/process behavior remain unverified.

- [x] Finish Phase 5 UI: add a Run plan control and poll/display plan-level execution progress; persist transient provider retry attempts and expose their count; verify duplicate active task/plan runs return conflicts.
- [ ] Complete Phase 6 real-time updates and improve task-plan visualization beyond the current one-second plan-progress polling.
- [ ] Implement browser automation and public web research with strict network controls.
- [ ] Complete Git integration with patch viewer/history/checkpoints/rollback and add task dependency visualization.
- [ ] Harden project memory retrieval, improve secret detection, and cover memory UI workflows with browser tests.
- [ ] Complete hardening, security coverage, browser tests, and release documentation.

## Architectural decisions

- The first persistence implementation uses Node's built-in `node:sqlite` driver to keep local setup small and deterministic. The repository isolates persistence behind `DatabaseService`, so Drizzle can replace it without changing callers.
- Provider credentials are deliberately not stored in application tables; cloud provider credentials are read from server environment only and are never returned by the API. The UI can select configured providers, but credential entry is managed through server configuration rather than persisted secret management.
- The mock provider is the default and powers the acceptance workflow without paid credentials.
- Task cancellation is cooperative: API cancellation aborts the active model request, the agent loop checks cancellation before tool dispatch, and cancelled task state is preserved after the run unwinds.

## Known blockers

- Real provider connectivity cannot be verified without user credentials.
- OpenAI API requests remain unverified unless the operator configures a valid key and model; no request is issued automatically.
- Anthropic and Gemini real API calls and Ollama local service calls remain unverified until configured by the operator.
- Browser automation and web research are planned subsequent increments; they are not presented as completed by this initial vertical slice.
- A compiled-server bind smoke test is blocked by the execution sandbox (`EPERM` when binding loopback), not by an application startup error. SQLite itself was smoke-tested successfully in Node 22.
- The execution sandbox also rejects child-process spawning with `EPERM`. Terminal session persistence and approval workflows are integration-tested, but successful subprocess output must be verified on a normal local host.
