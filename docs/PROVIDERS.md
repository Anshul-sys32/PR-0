# Model providers

## Mock

The mock adapter is always available and performs no network requests or paid inference.

## OpenAI

The OpenAI adapter uses the documented Responses API endpoint (`POST https://api.openai.com/v1/responses`). Configure `OPENAI_API_KEY` and `OPENAI_MODEL` in the server environment. Both values remain on the server. The model identifier is supplied by the operator; Project PR-0 does not assume a model name or pricing.

Tasks continue to use the mock provider unless the API request explicitly selects `providerId: "openai"`. Selecting OpenAI can incur API charges. Usage token counts are recorded when the API returns them. Cost is left unknown because this implementation does not use a versioned pricing table.

Provider calls have a 60 second default timeout and accept cancellation signals through the gateway. Real connectivity is not verified without a valid API key and model access.

## Anthropic

Uses the documented Messages endpoint. Configure `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL` server-side. Model IDs can be supplied per task. Message text, tool-use blocks, and token counts are normalized; cost remains unknown.

## Gemini

Uses the documented `models/{model}:generateContent` REST endpoint with the API key in the `x-goog-api-key` header. Configure `GEMINI_API_KEY` and optionally `GEMINI_MODEL`. Function calls and token usage are normalized.

## Ollama

Uses the native `/api/chat` endpoint with streaming disabled for this adapter version. `OLLAMA_BASE_URL` defaults to loopback at port 11434. Supply a model tag per task. Tool support depends on the selected local model.

Anthropic and Gemini real API calls and Ollama local service calls remain unverified until configured by the operator.
