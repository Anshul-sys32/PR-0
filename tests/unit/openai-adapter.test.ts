import { describe, expect, it, vi } from "vitest";
import { AnthropicMessagesAdapter, GeminiAdapter, OllamaAdapter, OpenAIResponsesAdapter, OpenRouterAdapter, RoutedModelAdapter, type ModelAdapter, type ModelRequest, type ModelResponse } from "@pr-0/model-gateway";

describe("OpenAI Responses adapter", () => {
  it("normalizes text, function calls, and usage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      output_text: "Working on it",
      output: [{ type: "function_call", call_id: "call_123", name: "filesystem.read", arguments: "{\"path\":\"README.md\"}" }],
      usage: { input_tokens: 21, output_tokens: 8 }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = new OpenAIResponsesAdapter("test-secret", "test-model", fetcher);
    const result = await adapter.generate({ system: "Follow rules", messages: [{ role: "user", content: "Read README" }], tools: [{ name: "filesystem.read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }] });
    expect(result).toMatchObject({ content: "Working on it", finishReason: "tool_calls", toolCalls: [{ id: "call_123", name: "filesystem.read", input: { path: "README.md" } }], usage: { inputTokens: 21, outputTokens: 8 } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model", instructions: "Follow rules" });
  });

  it("requires a configurable model and classifies provider failures without losing status", async () => {
    const adapter = new OpenAIResponsesAdapter("test-secret", undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(adapter.generate({ system: "", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("Select an OpenAI model");
    await expect(adapter.generate({ model: "configured", system: "", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("OpenAI 401 error");
  });
});

describe("other provider adapters", () => {
  it("normalizes Anthropic text and tool-use blocks", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "Read this file" }, { type: "tool_use", id: "toolu_1", name: "filesystem.read", input: { path: "README.md" } }], usage: { input_tokens: 11, output_tokens: 6 } }), { status: 200 }));
    const adapter = new AnthropicMessagesAdapter("test-secret", "test-model", fetcher);
    const response = await adapter.generate({ system: "Be helpful", messages: [{ role: "user", content: "Read README" }] });
    expect(response).toMatchObject({ content: "Read this file", toolCalls: [{ id: "toolu_1", name: "filesystem.read", input: { path: "README.md" } }], usage: { inputTokens: 11, outputTokens: 6 } });
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get("x-api-key")).toBe("test-secret");
  });

  it("normalizes Gemini function calls and token usage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Looking" }, { functionCall: { id: "gem-call", name: "filesystem_read", args: { path: "README.md" } } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } }), { status: 200 }));
    const adapter = new GeminiAdapter("test-secret", "test-model", fetcher);
    const response = await adapter.generate({ system: "Be helpful", messages: [{ role: "user", content: "Read README" }] });
    expect(response).toMatchObject({ content: "Looking", toolCalls: [{ id: "gem-call", name: "filesystem_read", input: { path: "README.md" } }], usage: { inputTokens: 10, outputTokens: 4 } });
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get("x-goog-api-key")).toBe("test-secret");
  });

  it("calls Ollama locally and normalizes its non-streaming chat response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: { content: "Local answer", tool_calls: [{ function: { name: "filesystem.read", arguments: { path: "README.md" } } }] }, prompt_eval_count: 8, eval_count: 3 }), { status: 200 }));
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", fetcher);
    const response = await adapter.generate({ model: "local-tag", system: "Be helpful", messages: [{ role: "user", content: "Read README" }] });
    expect(response).toMatchObject({ content: "Local answer", toolCalls: [{ id: "ollama-call-0", name: "filesystem.read", input: { path: "README.md" } }], usage: { inputTokens: 8, outputTokens: 3 } });
    expect(fetcher.mock.calls[0]![0]).toBeInstanceOf(URL);
  });

  it("reports Ollama connectivity and discovered model tags from a valid response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.2:latest" }] }), { status: 200 }));
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", fetcher);
    await expect(adapter.checkAvailability()).resolves.toEqual({ status: "connected", models: ["qwen2.5-coder:7b", "llama3.2:latest"] });
    expect(fetcher.mock.calls[0]![0]).toEqual(new URL("http://127.0.0.1:11434/api/tags"));
  });

  it("classifies Ollama authentication, rate limiting, unsupported endpoints, and malformed responses", async () => {
    for (const [status, expected] of [[401, "authentication_required"], [429, "rate_limited"], [404, "unsupported"]] as const) {
      const adapter = new OllamaAdapter("http://127.0.0.1:11434", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })));
      await expect(adapter.checkAvailability()).resolves.toMatchObject({ status: expected, models: [] });
    }
    const malformed = new OllamaAdapter("http://127.0.0.1:11434", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "" }] }), { status: 200 })));
    await expect(malformed.checkAvailability()).resolves.toMatchObject({ status: "unsupported", models: [] });
    const emptyBody = new OllamaAdapter("http://127.0.0.1:11434", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(emptyBody.checkAvailability()).resolves.toMatchObject({ status: "unsupported", models: [] });
    const oversized = new OllamaAdapter("http://127.0.0.1:11434", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-length": "300000" } })));
    await expect(oversized.checkAvailability()).resolves.toMatchObject({ status: "unsupported", models: [] });
  });

  it("reports an unreachable Ollama service without fabricating a response", async () => {
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", vi.fn<typeof fetch>().mockRejectedValue(new Error("socket unavailable")));
    await expect(adapter.checkAvailability()).resolves.toEqual({ status: "unavailable", models: [], error: "Cannot reach the configured Ollama service" });
  });

  it("bounds Ollama availability checks with a timeout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    }));
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", fetcher);
    await expect(adapter.checkAvailability(1)).resolves.toMatchObject({ status: "unavailable", error: "Ollama did not respond before the connection check timed out" });
  });

  it("rejects oversized Ollama request bodies before making a network call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new OllamaAdapter("http://127.0.0.1:11434", fetcher);
    await expect(adapter.generate({ model: "local-tag", system: "", messages: [{ role: "user", content: "x".repeat(1_000_001) }] })).rejects.toThrow("Ollama request exceeds");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("OpenRouter adapter and routing", () => {
  it("normalizes documented chat completions and reports the actual model and usage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "meta/test-coder:free",
      choices: [{ finish_reason: "tool_calls", message: { content: "Inspecting", tool_calls: [{ id: "call_1", type: "function", function: { name: "filesystem.read", arguments: "{\"path\":\"README.md\"}" } }] } }],
      usage: { prompt_tokens: 32, completion_tokens: 10, cost: 0 }
    }), { status: 200 }));
    const adapter = new OpenRouterAdapter("test-secret", undefined, fetcher);
    const response = await adapter.generate({ model: "openrouter/free", system: "System", messages: [{ role: "user", content: "Read README" }], tools: [{ name: "filesystem.read", description: "Read a workspace file", parameters: { type: "object", properties: { path: { type: "string" } } } }] });
    expect(response).toMatchObject({ content: "Inspecting", finishReason: "tool_calls", toolCalls: [{ id: "call_1", name: "filesystem.read", input: { path: "README.md" } }], usage: { inputTokens: 32, outputTokens: 10, estimatedCostUsd: 0 }, providerData: { provider: "openrouter", model: "meta/test-coder:free" } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "openrouter/free", max_tokens: 4096, stream: false, tools: [{ type: "function" }] });
  });

  it("uses live catalog model IDs and excludes paid or non-tool models in free-only mode", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "org/free-coder:free", name: "Free Coder", context_length: 64000, pricing: { prompt: "0", completion: "0", request: "0" }, supported_parameters: ["tools"] },
      { id: "org/paid-coder", name: "Paid Coder", context_length: 128000, pricing: { prompt: "0.000001", completion: "0.000002", request: "0" }, supported_parameters: ["tools"] },
      { id: "org/unknown-request-price", name: "Unknown Request Price", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "org/free-text:free", name: "Free Text", pricing: { prompt: "0", completion: "0", request: "0" }, supported_parameters: [] }
    ] }), { status: 200 }));
    const adapter = new OpenRouterAdapter("test-secret", undefined, fetcher);
    await expect(adapter.listModels({ freeOnly: true })).resolves.toMatchObject({ status: "configured", models: [{ id: "org/free-coder:free", free: true, supportsTools: true, contextLength: 64000 }] });
    await expect(adapter.listModels({ freeOnly: false })).resolves.toMatchObject({ status: "configured", models: [{ id: "org/free-coder:free", free: true }, { id: "org/paid-coder", free: false }, { id: "org/unknown-request-price", free: false }] });
    expect(String(fetcher.mock.calls[0]![0])).toContain("supported_parameters=tools");
  });

  it("normalizes auth, rate-limit, invalid-model, service, network, timeout, and malformed-response errors", async () => {
    for (const [status, message] of [[401, "authentication or access denied"], [429, "rate limited"], [404, "model unavailable"], [503, "provider service error"]] as const) {
      const adapter = new OpenRouterAdapter("test-secret", "org/model", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })));
      await expect(adapter.generate({ system: "", messages: [{ role: "user", content: "hello" }] })).rejects.toThrow(`OpenRouter HTTP ${status}: ${message}`);
    }
    const network = new OpenRouterAdapter("test-secret", "org/model", vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")));
    await expect(network.generate({ system: "", messages: [{ role: "user", content: "hello" }] })).rejects.toThrow("network down");
    const timed = new OpenRouterAdapter("test-secret", "org/model", vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))));
    await expect(timed.generate({ system: "", messages: [{ role: "user", content: "hello" }] }, { timeoutMs: 1 })).rejects.toThrow("Provider request timed out");
    const malformed = new OpenRouterAdapter("test-secret", "org/model", vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(malformed.generate({ system: "", messages: [{ role: "user", content: "hello" }] })).rejects.toThrow("malformed JSON");
  });

  it("reports catalog auth, rate-limit, unavailable, and malformed states", async () => {
    for (const [status, expected] of [[401, "authentication_required"], [429, "rate_limited"], [503, "unavailable"]] as const) {
      const adapter = new OpenRouterAdapter("test-secret", undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })));
      await expect(adapter.listModels({ refresh: true })).resolves.toMatchObject({ status: expected, models: [] });
    }
    const malformed = new OpenRouterAdapter("test-secret", undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "missing-pricing" }] }), { status: 200 })));
    await expect(malformed.listModels({ refresh: true })).resolves.toMatchObject({ status: "unsupported", models: [] });
  });

  it("propagates caller cancellation through an OpenRouter request", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      markStarted();
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const adapter = new OpenRouterAdapter("test-secret", "org/model", fetcher);
    const controller = new AbortController();
    const response = adapter.generate({ system: "", messages: [{ role: "user", content: "hello" }] }, { signal: controller.signal });
    await started;
    controller.abort(new Error("user cancelled"));
    await expect(response).rejects.toThrow("Provider request cancelled");
  });

  it("does not present truncated or filtered provider output as a complete response", async () => {
    for (const [finish_reason, message] of [["length", "output limit"], ["content_filter", "filtered"]] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: "partial" } }] }), { status: 200 }));
      const adapter = new OpenRouterAdapter("test-secret", "org/model", fetcher);
      await expect(adapter.generate({ system: "", messages: [{ role: "user", content: "hello" }] })).rejects.toThrow(message);
    }
  });

  it("fails closed for local-only, unconsented, and unverified paid routes", async () => {
    const hosted: ModelAdapter = { providerId: "openrouter", getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }), generate: vi.fn(async (): Promise<ModelResponse> => ({ content: "unexpected", toolCalls: [], finishReason: "stop", usage: {} })) };
    expect(() => new RoutedModelAdapter({ adapter: hosted, modelId: "openrouter/free", free: true }, [], { localOnly: true, freeOnly: true, hostedConsent: true })).toThrow("Local-only mode");
    expect(() => new RoutedModelAdapter({ adapter: hosted, modelId: "openrouter/free", free: true }, [], { localOnly: false, freeOnly: true, hostedConsent: false })).toThrow("consent");
    expect(() => new RoutedModelAdapter({ adapter: hosted, modelId: "org/paid", free: false }, [], { localOnly: false, freeOnly: true, hostedConsent: true })).toThrow("Free-only mode");
    expect(hosted.generate).not.toHaveBeenCalled();
  });

  it("falls back only to explicitly configured routes on a transient error", async () => {
    const primary: ModelAdapter = { providerId: "openrouter", getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }), generate: vi.fn(async (): Promise<ModelResponse> => { throw new Error("OpenRouter HTTP 429: rate limited"); }) };
    const fallback: ModelAdapter = { providerId: "ollama", getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }), generate: vi.fn(async (_request: ModelRequest): Promise<ModelResponse> => ({ content: "Local recovery", toolCalls: [], finishReason: "stop", usage: {} })) };
    const route = new RoutedModelAdapter({ adapter: primary, modelId: "openrouter/free", free: true }, [{ adapter: fallback, modelId: "local-coder", free: true }], { localOnly: false, freeOnly: true, hostedConsent: true });
    const response = await route.generate({ system: "", messages: [{ role: "user", content: "hello" }] });
    expect(response.content).toBe("Local recovery");
    expect(route.lastUsedProviderId).toBe("ollama");
    expect(route.lastUsedModelId).toBe("local-coder");
    expect(primary.generate).toHaveBeenCalledTimes(1);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });
});
