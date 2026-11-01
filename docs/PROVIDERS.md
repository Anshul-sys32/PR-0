# Model Providers

PR-0 uses the existing `ModelAdapter` gateway and agent loop for all providers. Provider IDs are selected explicitly for each task or plan. The UI starts with local Ollama selected; it does not silently fall back to another provider. Mock is an explicit test-only choice and does not call an AI model.

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

## Browser-Based Consumer Services

PR-0 does **not** automate authenticated consumer AI websites or reuse their browser sessions. The reviewed current terms do not establish permission for the requested automated browser integration:

- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/) prohibit automatically or programmatically extracting data or Output from consumer Services.
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms) prohibit automated/non-human access to consumer Services except via an Anthropic API key or where Anthropic explicitly permits it.
- [Google Terms of Service](https://policies.google.com/terms) prohibit automated access that violates a site's machine-readable instructions and do not provide explicit authorization for automating Gemini Apps as a model API.

Terms can change and may differ by product, region, account, or separate written agreement. PR-0 will only add a browser integration if a provider explicitly authorizes that exact method. Gemini API remains supported through its separate official API adapter; Ollama is the supported local alternative when avoiding a separate paid API key. No CAPTCHA, anti-bot, login, rate-limit, or access-control workaround is implemented.

## Reliability and Privacy

Hosted provider adapters use bounded request timeouts and propagate task cancellation. The agent loop applies the configured bounded retry policy to transient provider errors; authentication/configuration errors are not retried. Tool calls still pass through the existing schema, step, workspace, and approval controls. Provider credentials remain server-side and are not returned by the provider status endpoint. The test suite uses mocked provider responses and does not require user accounts or live external AI websites.
