import { describe, expect, it, vi } from "vitest";
import { AnthropicMessagesAdapter, GeminiAdapter, OllamaAdapter, OpenAIResponsesAdapter } from "@pr-0/model-gateway";

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
