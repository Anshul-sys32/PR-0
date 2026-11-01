# Project PR-0 implementation plan

## Current milestone: Release readiness and verification

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

- `npm run typecheck`: passed across shared, model-gateway, tool-runtime, agent-core, server, and web.
- `npm test`: passed, 7 test files and 76 tests.
- `npm run build`: passed across all workspaces. Vite emitted only its existing non-blocking React plugin performance recommendation.
- `npm run test:browser`: passed, 4 workflows, including an API-backed task create/run after explicitly selecting test-only Mock, Ollama-default UI, approval/memory safety, and responsive navigation.
- `npx vitest run tests/unit/openai-adapter.test.ts`: passed, 10 tests including Ollama availability, auth/rate-limit/unsupported/malformed/unavailable/timeout cases, and request/response size limits using mocked fetch.
- `npx vitest run tests/integration/api.test.ts`: passed, 20 tests including provider status metadata and discovered local model tags via mocked Ollama response.
- `git diff --check`: passed after provider implementation and documentation updates.
- No real Ollama daemon/model or cloud provider credentials were available; live inference and provider account connectivity were not tested. No consumer AI websites were automated.


## In-progress MVP capability

- The first persistence implementation uses Node's built-in `node:sqlite` driver to keep local setup small and deterministic. The repository isolates persistence behind `DatabaseService`, so Drizzle can replace it without changing callers.
- Provider credentials are deliberately not stored in application tables; cloud provider credentials are read from server environment only and are never returned by the API. The UI can select configured providers, but credential entry is managed through server configuration rather than persisted secret management.
- Local Ollama is the normal UI provider choice and uses its documented HTTP API without a separate paid provider key. The deterministic mock adapter remains available only as an explicit test-only choice; it is not a real model.
- Task cancellation is cooperative: API cancellation aborts the active model request, the agent loop checks cancellation before tool dispatch, and cancelled task state is preserved after the run unwinds.

## Known blockers

- Real provider connectivity cannot be verified without user credentials.
- OpenAI API requests remain unverified unless the operator configures a valid key and model; no request is issued automatically.
- Anthropic and Gemini real API calls and Ollama local service calls remain unverified until configured by the operator.
- Browser and research access remain user-initiated and constrained to validated public HTTPS navigation; page scripts, subresources, forms, downloads, popups, and model-invoked web access are disabled.
- Model-requested writes pause the current in-memory agent loop. If the server restarts while awaiting approval, recovery marks the task failed and invalidates the approval rather than resuming the model conversation; the user can create a new task after restart.
- Once an agent-write approval is claimed for execution, cancellation returns HTTP 409 until the write completes. If cancellation wins before approval is claimed, the pending operation is rejected and no file is written.
- The API does not authenticate callers and must remain bound to loopback; CORS is not an authorization boundary. See `docs/RELEASE.md` before preparing a candidate.
- No consumer AI website browser provider is implemented: current reviewed terms do not explicitly authorize the requested automation for OpenAI/Anthropic consumer services, and Google's terms prohibit automated access that violates machine-readable site instructions. Use the existing official API adapters or the documented local Ollama integration instead.
- Ollama reachability and installed model tags are now checked through a bounded `/api/tags` probe, but live Ollama inference remains unverified until an operator runs a local daemon and pulls a model.
- Ollama status checks time out after 2.5 seconds and cap model-list responses at 256 KB; inference requests cap serialized payloads at 1 MB, response bodies at 2 MB, and use the configured 60-second default provider timeout with cancellation propagation.
- A compiled-server bind smoke test is blocked by the execution sandbox (`EPERM` when binding loopback), not by an application startup error. SQLite itself was smoke-tested successfully in Node 22.
- The execution sandbox also rejects child-process spawning with `EPERM`. Terminal session persistence and approval workflows are integration-tested, but successful subprocess output must be verified on a normal local host.

## Provider integration follow-up

- [x] Audit provider contracts, server registration, UI selection, agent tool loop, docs, and baseline. Baseline `npm run typecheck`, `npm test` (70 tests), and `npm run build` passed before edits.
- [x] Verify consumer browser-provider authorization before implementation. No reviewed consumer-site terms explicitly permit this PR-0 automation; no login/session automation or credential extraction was added.
- [x] Make Ollama the normal UI provider, keep Mock explicitly test-only, report actual local service status/model tags, and gate model execution on provider/model readiness.
- [x] Add deterministic Ollama status/normalization tests and a mocked API provider-status integration test.
- [ ] Verify a real local Ollama install/model end to end; no daemon/model is available in this test environment.

## Consumer Browser Provider Audit (2026-11-01)

- [x] Audit the model gateway, existing API/Ollama adapters, Playwright runtime, agent loop, provider UI, provider/security docs, environment example, and current implementation plan.
- [x] Review official terms/help and site instructions for ChatGPT, Claude, Gemini Apps, Microsoft Copilot, Perplexity, and Duck.ai. No candidate establishes a permitted consumer-chat automation path; guest access is not automation permission.
- [x] Keep the existing provider gateway and Ollama/API adapters unchanged. No browser provider was implemented, and no private endpoints, cookie/token extraction, CAPTCHA bypass, or anti-bot evasion was added.
- [x] Record viable API/local alternatives and current limitations in `docs/PROVIDERS.md`.
- [x] Add one-run hosted inference consent; credential-like task/history/memory/tool-result content is blocked before transmission. Metadata-only OpenRouter catalog access is separate from project-content inference and is suppressed in local-only mode.
- [ ] Reconsider a browser provider only after the provider publishes or grants permission for the exact automated prompting and response-retrieval method.

## Free-First Provider Routing

- [x] Add an OpenRouter adapter through the existing `ModelAdapter` gateway using the documented Chat Completions API and live `/models` catalog.
- [x] Add the documented `openrouter/free` route and live catalog validation for explicit model IDs; free-only rejects paid and unverified hosted routes.
- [x] Add local-only and hosted-consent enforcement before hosted inference, including task planning and plan task execution; local-only also suppresses hosted catalog lookup.
- [x] Add explicit fallback-provider allowlisting; fallbacks are bounded, transient-error-only, policy-checked, and stop once a response/tool call is returned.
- [x] Add locally persisted provider/model and policy preferences, per-run hosted data consent, capability/catalog status, and provider/model reporting.
- [x] Add deterministic OpenRouter normalization, catalog, error, policy, fallback, agent-loop, and API integration tests.
- [ ] Verify live OpenRouter inference with an operator-provided API key; no live credentials were used for this implementation.
- [ ] Add persistent task-level route events if users need to inspect multiple provider transitions after a fallback sequence.
