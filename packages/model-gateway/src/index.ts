import { z } from "zod";
import type { ToolCall } from "@pr-0/shared";
export interface ModelCapabilities { streaming: boolean; toolCalling: boolean; structuredOutput: boolean; vision: boolean; supportsCancellation: boolean; maxContextTokens?: number; maxOutputTokens?: number }
export interface ModelMessage { role: "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolName?: string; toolCalls?: ToolCall[]; providerData?: unknown }
export interface ModelRequest { model?: string; system: string; messages: ModelMessage[]; tools?: Array<{ name: string; description: string; parameters?: Record<string, unknown> }> }
export interface ModelResponse { content: string; toolCalls: ToolCall[]; finishReason: "stop" | "tool_calls" | "error"; usage: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }; providerData?: unknown }
export interface ModelRequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface ModelAdapter { readonly providerId: string; getCapabilities(modelId: string): ModelCapabilities; generate(request: ModelRequest, options?: ModelRequestOptions): Promise<ModelResponse> }
export class MockModelAdapter implements ModelAdapter {
  readonly providerId = "mock";
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: false, supportsCancellation: false, maxContextTokens: 32000 }; }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const last = request.messages.at(-1)?.content ?? "";
    return { content: `Mock provider received: ${last}. No external model was called.`, toolCalls: [], finishReason: "stop", usage: { inputTokens: Math.ceil(last.length / 4), outputTokens: 16, estimatedCostUsd: 0 } };
  }
}

const responseSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    id: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
  }).passthrough()).default([]),
  output_text: z.string().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional()
}).passthrough();

export class OpenAIResponsesAdapter implements ModelAdapter {
  readonly providerId = "openai";
  constructor(private readonly apiKey: string, private readonly defaultModel?: string, private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error("OpenAI API key is required");
  }
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: true, supportsCancellation: true }; }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel;
    if (!model) throw new Error("Select an OpenAI model or configure OPENAI_MODEL");
    const input: Array<Record<string, unknown>> = request.messages.flatMap((message): Array<Record<string, unknown>> => {
      if (message.role === "tool") {
        if (!message.toolCallId) throw new Error("OpenAI tool results require a toolCallId");
        return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
      }
      if (message.role === "assistant" && message.toolCalls?.length) return [
        ...(message.content ? [{ role: "assistant", content: [{ type: "output_text", text: message.content }] }] : []),
        ...message.toolCalls.map((call) => ({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.input) }))
      ];
      return [{ role: message.role, content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }] }];
    });
    const tools = request.tools?.map((tool) => ({
      type: "function", name: tool.name, description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {}, additionalProperties: false }, strict: true
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("OpenAI request timed out")), options.timeoutMs ?? 60_000);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, instructions: request.system, input, ...(tools?.length ? { tools } : {}) }), signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string; type?: string; code?: string } } | null;
        const safeMessage = body?.error?.message?.slice(0, 500) ?? `OpenAI request failed with HTTP ${response.status}`;
        throw new Error(`OpenAI ${response.status} ${body?.error?.code ?? body?.error?.type ?? "error"}: ${safeMessage}`);
      }
      const data = responseSchema.parse(await response.json());
      const toolCalls: ToolCall[] = data.output.filter((item) => item.type === "function_call").map((item) => {
        if (!item.call_id || !item.name || item.arguments === undefined) throw new Error("OpenAI returned an incomplete function call");
        return { id: item.call_id, name: item.name, input: JSON.parse(item.arguments) as unknown };
      });
      const content = data.output_text ?? data.output.flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text" && part.text).map((part) => part.text).join("");
      return { content, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "OpenAI request cancelled" : "OpenAI request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

const timedFetch = async (fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit, options: ModelRequestOptions): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Provider request timed out")), options.timeoutMs ?? 60_000);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  try { return await fetcher(input, { ...init, signal: controller.signal }); }
  catch (error) { if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "Provider request cancelled" : "Provider request timed out"); throw error; }
  finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
};
const providerError = async (provider: string, response: Response): Promise<Error> => {
  const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
  const message = (body?.error?.message ?? body?.message)?.slice(0, 500);
  return new Error(`${provider} HTTP ${response.status}: ${message ?? "request failed"}`);
};
const anthropicResponseSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional(), id: z.string().optional(), name: z.string().optional(), input: z.unknown().optional() }).passthrough()), usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(), stop_reason: z.string().optional() }).passthrough();
export class AnthropicMessagesAdapter implements ModelAdapter {
  readonly providerId = "anthropic";
  constructor(private readonly apiKey: string, private readonly defaultModel?: string, private readonly fetcher: typeof fetch = fetch) { if (!apiKey.trim()) throw new Error("Anthropic API key is required"); }
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: true, supportsCancellation: true }; }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel; if (!model) throw new Error("Select an Anthropic model or configure ANTHROPIC_MODEL");
    const messages = request.messages.map((message) => message.role === "tool" ? { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] } : message.role === "assistant" && message.toolCalls?.length ? { role: "assistant", content: [...(message.content ? [{ type: "text", text: message.content }] : []), ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input }))] } : { role: message.role, content: message.content });
    const tools = request.tools?.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters ?? { type: "object", properties: {} } }));
    const response = await timedFetch(this.fetcher, "https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4096, system: request.system, messages, ...(tools?.length ? { tools } : {}) }) }, options);
    if (!response.ok) throw await providerError("Anthropic", response);
    const data = anthropicResponseSchema.parse(await response.json()); const toolCalls: ToolCall[] = data.content.filter((item) => item.type === "tool_use").map((item) => { if (!item.id || !item.name) throw new Error("Anthropic returned an incomplete tool call"); return { id: item.id, name: item.name, input: item.input }; });
    return { content: data.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join(""), toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
  }
}

const geminiResponseSchema = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional(), functionCall: z.object({ id: z.string().optional(), name: z.string(), args: z.unknown().optional() }).optional() }).passthrough()).default([]) }).optional() }).passthrough()).default([]), usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() }).optional() }).passthrough();
export class GeminiAdapter implements ModelAdapter {
  readonly providerId = "gemini";
  constructor(private readonly apiKey: string, private readonly defaultModel?: string, private readonly fetcher: typeof fetch = fetch) { if (!apiKey.trim()) throw new Error("Gemini API key is required"); }
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: true, supportsCancellation: true }; }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel; if (!model) throw new Error("Select a Gemini model or configure GEMINI_MODEL");
    const contents = request.messages.map((message) => {
      if (message.role === "tool") return { role: "user", parts: [{ functionResponse: { ...(message.toolCallId ? { id: message.toolCallId } : {}), name: message.toolName ?? "tool", response: { result: message.content } } }] };
      if (message.role === "assistant" && message.providerData) return message.providerData;
      const parts = message.role === "assistant" && message.toolCalls?.length
        ? message.toolCalls.map((call) => ({ functionCall: { id: call.id, name: call.name, args: call.input } }))
        : [{ text: message.content }];
      return { role: message.role === "assistant" ? "model" : "user", parts };
    });
    const functionDeclarations = request.tools?.map((tool) => ({ name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"), description: tool.description, parameters: tool.parameters ?? { type: "OBJECT", properties: {} } }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await timedFetch(this.fetcher, url, { method: "POST", headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] }, contents, ...(functionDeclarations?.length ? { tools: [{ functionDeclarations }] } : {}) }) }, options);
    if (!response.ok) throw await providerError("Gemini", response);
    const data = geminiResponseSchema.parse(await response.json()); const candidate = data.candidates[0]?.content; const parts = candidate?.parts ?? []; const toolCalls: ToolCall[] = parts.flatMap((part, index) => { if (!part.functionCall) return []; const registered = request.tools?.find((tool) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_") === part.functionCall!.name); return [{ id: part.functionCall.id ?? `gemini-call-${index}`, name: registered?.name ?? part.functionCall.name, input: part.functionCall.args ?? {} }]; });
    return { content: parts.filter((part) => part.text).map((part) => part.text).join(""), toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount }, providerData: toolCalls.length ? candidate : undefined };
  }
}

const ollamaResponseSchema = z.object({ message: z.object({ content: z.string().default(""), tool_calls: z.array(z.object({ id: z.string().optional(), function: z.object({ name: z.string(), arguments: z.unknown() }) })).default([]) }), prompt_eval_count: z.number().optional(), eval_count: z.number().optional() }).passthrough();
export class OllamaAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  constructor(private readonly baseUrl = "http://127.0.0.1:11434", private readonly fetcher: typeof fetch = fetch, private readonly defaultModel?: string) { const url = new URL(baseUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Ollama base URL"); }
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: false, supportsCancellation: true }; }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel; if (!model) throw new Error("Select an Ollama model id");
    const messages = [{ role: "system", content: request.system }, ...request.messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : message.role, content: message.content, ...(message.toolName ? { tool_name: message.toolName } : {}), ...(message.role === "assistant" && message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.input } })) } : {}) }))];
    const tools = request.tools?.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} } } }));
    const response = await timedFetch(this.fetcher, new URL("/api/chat", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages, stream: false, ...(tools?.length ? { tools } : {}) }) }, options);
    if (!response.ok) throw await providerError("Ollama", response);
    const data = ollamaResponseSchema.parse(await response.json()); const toolCalls: ToolCall[] = data.message.tool_calls.map((call, index) => ({ id: call.id ?? `ollama-call-${index}`, name: call.function.name, input: call.function.arguments }));
    return { content: data.message.content, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count } };
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ModelAdapter>([["mock", new MockModelAdapter()]]);
  get(providerId: string): ModelAdapter { const adapter = this.adapters.get(providerId); if (!adapter) throw new Error(`Provider ${providerId} is not configured`); return adapter; }
  register(adapter: ModelAdapter): void { this.adapters.set(adapter.providerId, adapter); }
  list(): string[] { return [...this.adapters.keys()]; }
}
