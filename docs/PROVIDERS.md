# Model Providers

PR-0 uses the existing `ModelAdapter` gateway and agent loop for all providers. Provider IDs are selected explicitly for each task or plan. The UI remembers the preferred provider/model and starts with local Ollama unless changed; it does not silently fall back. Fallback providers must be separately allowed in settings, and hosted routes require per-run consent. Mock is an explicit test-only choice and does not call an AI model.

## Local Ollama (no separate paid API key)

Ollama is the supported local, no-paid-provider-key integration. PR-0 uses Ollama's documented native HTTP API, not a consumer website or browser session:

- Chat and tool calls: `POST /api/chat` with streaming disabled.
- Reachability and installed model discovery: `GET /api/tags`.
- Official docs: [Ollama chat API](https://docs.ollama.com/api/chat), [Ollama model-list API](https://docs.ollama.com/api/tags), [Ollama downloads](https://ollama.com/download).

Install and start Ollama using its official instructions, then pull a model supported by your machine. For example:

```sh
ollama serve
ollama pull qwen2.5-coder:7b
```

Configure `OLLAMA_BASE_URL` (defaults to `http://127.0.0.1:11434`) and optionally `OLLAMA_MODEL` in the server environment. The model selector can use models reported by the running service; without an environment default, PR-0 preselects the first installed model returned by `/api/tags`. You can override the model identifier in Task options. Model capability varies: tool calling is only useful when the selected Ollama model supports it.

The provider status endpoint probes `/api/tags` with a 2.5-second timeout and a 256 KB response cap. It reports `connected`, `authentication_required`, `rate_limited`, `unsupported`, or `unavailable`, plus discovered tags when available. Ollama generation has a 60-second default timeout, a 1 MB serialized request cap, a 2 MB response cap, and propagates task cancellation. These are transport safeguards, not a guarantee that every prompt/model will succeed. Refresh provider status after starting Ollama or pulling a model. No browser profile, cookies, account credentials, or local-storage secrets are read or persisted.

Local inference still has hardware, download, and model-license requirements. “No paid API key” does not mean unlimited or cost-free compute.

## Mock (test only)

The Mock adapter is deterministic, performs no network request, and returns a fixed explanatory response. It is not a real AI provider and must not be used to evaluate real feature generation. Select it explicitly for tests and UI workflow checks.

## OpenAI API

The OpenAI adapter uses the documented Responses API (`POST https://api.openai.com/v1/responses`). Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` on the server. Calls can incur API charges. The model identifier is operator-supplied; usage token counts are persisted when returned, while cost remains unknown without a versioned pricing table. Real connectivity has not been verified without valid credentials.

## Anthropic API

The Anthropic adapter uses the documented Messages API. Set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL` on the server. Text, tool-use blocks, and token counts are normalized. Real connectivity has not been verified without valid credentials.

## Gemini API

The Gemini adapter uses the documented `models/{model}:generateContent` API and the `x-goog-api-key` header. Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` on the server. Function calls and token usage are normalized. Real connectivity has not been verified without valid credentials.

## OpenRouter API

OpenRouter is implemented as an API adapter in the existing model gateway. It uses the official OpenAI-compatible Chat Completions endpoint, `POST https://openrouter.ai/api/v1/chat/completions`, with bearer authentication and normalized assistant text, function calls, token usage, actual returned model ID, and provider cost when returned. Calls are non-streaming because the current `ModelAdapter`/agent loop consumes complete responses. Requests honor cancellation and the configured provider timeout; authentication/access errors, credit/quota errors, rate limits, unavailable models, malformed output, timeouts, and network errors are reported without fabricating a response.

Set `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in the server environment. The default is the documented `openrouter/free` router. The adapter queries the official `GET https://openrouter.ai/api/v1/models` catalog (filtered to text output and `tools`) and uses its live model IDs, pricing, context length, max output, and supported parameters; it does not ship a hardcoded free-model list. Catalog entries are cached in memory for five minutes. The provider UI shows tool-capable models and identifies free entries from zero prompt, completion, and request pricing. `openrouter/free` is offered as the documented free-only router and selects only free models that satisfy the requested tool capability.

Free model availability and performance vary. Official OpenRouter limits currently document 20 requests/minute and 50 requests/day for free variants when fewer than $10 in credits have been purchased; accounts that have purchased at least $10 have a 1,000/day ceiling. Limits can change and model/provider limits can additionally apply. Free models can be unavailable or high-latency. Do not mix paid model IDs into a free-model fallback list: OpenRouter documents that doing so can bill a paid fallback. PR-0's free-only mode rejects paid or unverified OpenRouter models and only uses `openrouter/free` or a model returned by the live catalog with zero prices and tool support. Real OpenRouter inference has not been live-tested in this environment.

## Provider Settings, Consent, and Fallback

Provider and model preference, free-only/local-only policy, and allowed fallback provider IDs are stored in the browser's local storage. Hosted consent is one-run and is cleared after task or plan actions; it is not persisted. Before hosted inference, the server requires `hostedConsent: true`; consent covers task text, conversation history, project-memory context, and model-requested workspace file/tool results. OpenRouter model-catalog requests contain model metadata only, no project context, and occur only when selected outside local-only mode. The server independently rejects hosted inference routes in local-only mode and paid/unverified routes in free-only mode. These controls are defense-in-depth for a loopback-only local application, not multi-user authorization.

Fallback is off unless the user explicitly selects fallback providers. For a selected configured fallback, the gateway tries each candidate at most once for that model request and only after transient network/timeout, 408, 402 credit/quota, 429, or 5xx failures. It does not retry on authentication, invalid-model, malformed-response, or other deterministic errors. A response (including a tool call) is returned immediately and is never replayed through another provider, preventing duplicate tool execution. Existing bounded agent retries remain in force. Fallback routes are prevalidated against the same local-only, hosted-consent, and free-only settings. The UI reports the provider/model that actually responded.

The provider UI exposes live OpenRouter model metadata and shows tool-calling support, streaming behavior (not used by this agent loop), cancellation, and context limits when available. General provider status does not probe OpenRouter. Selecting OpenRouter outside local-only mode loads its catalog and can change status to authentication-required, rate-limited, or unavailable. Even a successful catalog query reports `configured`, not `connected`; actual inference is not claimed until a task receives a response, and the task records the actual provider/model.

## Browser-Based Consumer Services

PR-0 does **not** automate authenticated consumer AI websites or reuse their browser sessions. The reviewed current terms do not establish permission for the requested automated browser integration:

- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/) prohibit automatically or programmatically extracting data or Output from consumer Services.
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms) prohibit automated/non-human access to consumer Services except via an Anthropic API key or where Anthropic explicitly permits it.
- [Google Terms of Service](https://policies.google.com/terms) prohibit automated access that violates a site's machine-readable instructions and do not provide explicit authorization for automating Gemini Apps as a model API.

Terms can change and may differ by product, region, account, or separate written agreement. PR-0 will only add a browser integration if a provider explicitly authorizes that exact method. Gemini API remains supported through its separate official API adapter; Ollama is the supported local alternative when avoiding a separate paid API key. No CAPTCHA, anti-bot, login, rate-limit, or access-control workaround is implemented.

## Consumer Web-Service Audit (2026-11-01)

Guest access is not permission to automate a consumer chat page. The following official sources were reviewed for guest access, account requirements, terms, service instructions, usage limits, and persistent sessions. CAPTCHA behavior was not documented in the reviewed sources unless explicitly noted; no CAPTCHA handling is implemented.

| Service | Guest/account status | Automated browser method and permission | Limits, sessions, coding-agent practicality |
|---|---|---|---|
| ChatGPT | General guest access was not established from the reviewed current terms. Some limited product pages may be public, but official help says a user must sign in to start a GPT conversation. | **Not permitted for this use.** OpenAI's consumer Terms prohibit automatically or programmatically extracting data or Output. No documented browser-chat integration method was found. | Account, region, and plan limits vary; terms prohibit bypassing limits/protective measures. A normal account may preserve chats, but PR-0 must not reuse it for automation. Not suitable as a browser provider. |
| Claude | No supported guest route was found; the reviewed official sources do not conclusively state whether an account is mandatory for every consumer feature. | **Not permitted without explicit permission or API-key access.** Consumer Terms prohibit automated/non-human access except through an Anthropic API key or where Anthropic explicitly permits it. | Free-plan usage is session-limited, resets every five hours, and varies with demand. Normal account history is not authorization for PR-0 automation. Not suitable as a browser provider. |
| Gemini Apps | **Guest access exists for some web-app features.** Sign-in is needed for additional features and to save Gemini Apps activity. | **Not permitted for the chat routes reviewed.** Google's Terms condition automated access on machine-readable instructions. The current [Gemini robots.txt](https://gemini.google.com/robots.txt) disallows `/app/` and `/chat/`; no separate permission for PR-0 automation was found. | Feature/model usage limits vary; CAPTCHA behavior was not documented. Guest activity is not a persistent saved chat session. The consumer web app is not an authorized repeated coding-agent route. The separate Gemini Developer API is supported below. |
| Microsoft Copilot | Microsoft Account is required by the Copilot supplemental terms. | **Not permitted.** Copilot terms say not to use bots or scrapers to access it; the Microsoft Services Agreement also restricts AI-service scraping unless explicitly permitted. | Microsoft may limit speed/performance and availability. No numeric web-chat limit or CAPTCHA behavior was established. Account sessions do not authorize automation. Not suitable as a browser provider. |
| Perplexity | Account requirements vary by product/feature; the reviewed current Help Center and Terms did not conclusively establish guest chat availability, so treat it as unverified. | **Not permitted.** Terms prohibit unauthorized automation software, bots, robots/crawlers/scrapers, and automated extraction. No documented browser integration for consumer chat was found. | Limits and retention differ by feature/plan; the reviewed pages did not establish a stable guest-session or CAPTCHA policy. Not suitable for repeated coding-agent requests. |
| Duck.ai | Public help presents a free chat service; the reviewed pages do not explicitly guarantee that every basic chat route works without sign-in. Treat guest eligibility as unverified. | **Not permitted.** Duck.ai Terms prohibit automated querying and circumventing rate limits or other restrictions. No supported consumer-chat automation interface was found. | Free use has a daily limit; the exact anonymous enforcement method is intentionally undisclosed. Chat history is local by default; optional Sync & Backup is end-to-end encrypted. Not suitable for repeated agent requests despite free manual use. |

Official evidence: [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/), [OpenAI GPT conversation access help](https://help.openai.com/en/articles/8554407-gpts-in-chatgpt), [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms), [Claude access and free-plan limits](https://support.claude.com/en/articles/8114491-how-can-i-access-claude-ai), [Google Terms](https://policies.google.com/terms), [Gemini sign-in help](https://support.google.com/gemini/answer/13278668), [Microsoft Copilot Terms](https://www.microsoft.com/en-us/microsoft-copilot/for-individuals/termsofuse), [Microsoft Services Agreement](https://www.microsoft.com/en-us/servicesagreement), [Perplexity Terms](https://www.perplexity.ai/hub/legal/terms-of-service), [Duck.ai Terms](https://duckduckgo.com/aichat/privacy-terms), [Duck.ai usage limits](https://duckduckgo.com/duckduckgo-help-pages/duckai/usage-limits), and [Duck.ai chat-history help](https://duckduckgo.com/duckduckgo-help-pages/duckai/recent-chats).

## Viable Alternatives

- **Implemented and tested in the deterministic suite:** Ollama uses the documented local HTTP API and does not send prompts or project files to a hosted model provider. Hardware, model downloads, model licensing, and live inference remain operator responsibilities; live inference was not verified in this environment.
- **Implemented, API-only, not live-tested here:** Gemini Developer API uses the documented `generateContent` endpoint. Google's [current pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists a free tier for selected models with changing quotas; an API key is required, eligibility/model limits vary, and free-tier content may be used to improve Google products. Do not treat it as unlimited or suitable for private code without explicit user consent.
- **Implemented, mocked-tested, not live-tested:** OpenRouter through its documented API. An account/API key is required; the official `openrouter/free` router is designed to select only free variants, but availability, latency, quotas, and tool support vary. It is not a consumer guest/browser integration.
- **Not permitted or unsupported:** consumer chat-page automation listed in the audit table. Do not substitute private endpoints, browser token/cookie extraction, CAPTCHA bypass, or anti-bot evasion.

The provider dropdown is an explicit provider choice; hosted routes additionally require the one-run consent control described above. Use local-only mode or local Ollama for code that must stay local. Current model tools exclude common secret files and sensitive paths, but users remain responsible for reviewing prompts, project memory, and file/tool results before authorizing hosted processing.

## Reliability and Privacy

Hosted provider adapters use bounded request timeouts and propagate task cancellation. The agent loop applies the configured bounded retry policy to transient provider errors; authentication/configuration errors are not retried. Tool calls still pass through the existing schema, step, workspace, and approval controls. Provider credentials remain server-side and are not returned by the provider status endpoint. The test suite uses mocked provider responses and does not require user accounts or live external AI websites.
