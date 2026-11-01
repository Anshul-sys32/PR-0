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

const openRouterCatalogSchema = z.object({ data: z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  context_length: z.number().optional(),
  pricing: z.object({ prompt: z.string(), completion: z.string(), request: z.string().optional() }).passthrough(),
  supported_parameters: z.array(z.string()).default([]),
  architecture: z.object({ input_modalities: z.array(z.string()).default([]), output_modalities: z.array(z.string()).default([]) }).passthrough().optional(),
  top_provider: z.object({ max_completion_tokens: z.number().nullable().optional() }).passthrough().optional()
})) });
const openRouterResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      content: z.union([z.string(), z.null()]).optional(),
      tool_calls: z.array(z.object({ id: z.string(), type: z.string().optional(), function: z.object({ name: z.string(), arguments: z.string() }) })).optional()
    }).passthrough()
  }).passthrough()).default([]),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), cost: z.number().optional() }).passthrough().optional()
}).passthrough();
export type OpenRouterModel = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  promptPriceUsdPerToken: number | null;
  completionPriceUsdPerToken: number | null;
  supportsTools: boolean;
  free: boolean;
};
export type OpenRouterAvailability = { status: "configured"; models: OpenRouterModel[] } | { status: "authentication_required" | "rate_limited" | "unavailable" | "unsupported"; models: []; error: string };

function normalizedOpenRouterModel(model: z.infer<typeof openRouterCatalogSchema>["data"][number]): OpenRouterModel {
  const promptPrice = Number(model.pricing.prompt);
  const completionPrice = Number(model.pricing.completion);
  const requestPrice = model.pricing.request === undefined ? Number.NaN : Number(model.pricing.request);
  const validPrices = Number.isFinite(promptPrice) && Number.isFinite(completionPrice);
  return {
    id: model.id,
    name: model.name,
    ...(model.description ? { description: model.description.slice(0, 300) } : {}),
    ...(model.context_length ? { contextLength: model.context_length } : {}),
    ...(model.top_provider?.max_completion_tokens ? { maxOutputTokens: model.top_provider.max_completion_tokens } : {}),
    promptPriceUsdPerToken: validPrices ? promptPrice : null,
    completionPriceUsdPerToken: validPrices ? completionPrice : null,
    supportsTools: model.supported_parameters.includes("tools"),
    free: validPrices && Number.isFinite(requestPrice) && promptPrice === 0 && completionPrice === 0 && requestPrice === 0
  };
}

export class OpenRouterAdapter implements ModelAdapter {
  readonly providerId = "openrouter";
  private catalog?: OpenRouterModel[];
  private catalogFetchedAt = 0;
  constructor(private readonly apiKey: string, private readonly defaultModel?: string, private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error("OpenRouter API key is required");
  }
  getCapabilities(modelId: string): ModelCapabilities {
    const model = this.catalog?.find((candidate) => candidate.id === modelId);
    return { streaming: false, toolCalling: model?.supportsTools ?? true, structuredOutput: false, vision: false, supportsCancellation: true, maxContextTokens: model?.contextLength, maxOutputTokens: model?.maxOutputTokens };
  }
  async listModels(options: { freeOnly?: boolean; refresh?: boolean; timeoutMs?: number } = {}): Promise<OpenRouterAvailability> {
    const cachedCatalog = this.catalog;
    if (!options.refresh && cachedCatalog && Date.now() - this.catalogFetchedAt < 5 * 60_000) {
      return { status: "configured", models: this.selectModels(cachedCatalog, options.freeOnly ?? false) };
    }
    let response: Response;
    try {
      response = await timedFetch(this.fetcher, "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools", {
        method: "GET", headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" }
      }, { timeoutMs: options.timeoutMs ?? 8_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network failure";
      return { status: "unavailable", models: [], error: message.includes("timed out") ? "OpenRouter model catalog request timed out" : "Cannot reach the OpenRouter model catalog" };
    }
    if (response.status === 401 || response.status === 403) return { status: "authentication_required", models: [], error: "OpenRouter rejected the configured API key" };
    if (response.status === 429) return { status: "rate_limited", models: [], error: "OpenRouter model catalog is rate limited; try again later" };
    if (!response.ok) return { status: response.status === 404 ? "unsupported" : "unavailable", models: [], error: `OpenRouter model catalog request failed with HTTP ${response.status}` };
    try {
      const data = openRouterCatalogSchema.parse(await response.json());
      const models = data.data.map(normalizedOpenRouterModel);
      this.catalog = models;
      this.catalogFetchedAt = Date.now();
      return { status: "configured", models: this.selectModels(models, options.freeOnly ?? false) };
    } catch {
      return { status: "unsupported", models: [], error: "OpenRouter returned an unsupported model catalog response" };
    }
  }
  private selectModels(models: OpenRouterModel[], freeOnly: boolean): OpenRouterModel[] {
    return models.filter((model) => model.supportsTools && (!freeOnly || model.free));
  }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel;
    if (!model) throw new Error("Select an OpenRouter model or configure OPENROUTER_MODEL");
    const tools = request.tools?.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} } } }));
    const messages = [
      { role: "system", content: request.system },
      ...request.messages.map((message) => message.role === "assistant" && message.toolCalls?.length
        ? { role: "assistant", content: message.content || null, tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } })) }
        : message.role === "tool"
          ? { role: "tool", tool_call_id: message.toolCallId, content: message.content }
          : { role: message.role, content: message.content })
    ];
    const response = await timedFetch(this.fetcher, "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "http-referer": "https://github.com/Anshul-sys32/PR-0", "x-openrouter-title": "PR-0" },
      body: JSON.stringify({ model, messages, max_tokens: 4096, ...(tools?.length ? { tools, tool_choice: "auto" } : {}), stream: false })
    }, options);
    if (!response.ok) {
      const status = response.status;
      const category = status === 401 || status === 403 ? "authentication or access denied" : status === 402 ? "credit limit exhausted" : status === 404 ? "model unavailable" : status === 429 ? "rate limited" : status >= 500 ? "provider service error" : "request rejected";
      throw new Error(`OpenRouter HTTP ${status}: ${category}`);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error("OpenRouter returned malformed JSON"); }
    const data = openRouterResponseSchema.safeParse(payload);
    if (!data.success || !data.data.choices[0]) throw new Error("OpenRouter returned an unsupported chat completion response");
    const finishReason = data.data.choices[0].finish_reason;
    if (finishReason === "length") throw new Error("OpenRouter response reached the 4096-token output limit");
    if (finishReason === "content_filter") throw new Error("OpenRouter filtered the model response");
    if (finishReason === "error") throw new Error("OpenRouter provider returned an unsuccessful response");
    const message = data.data.choices[0].message;
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => {
      let input: unknown;
      try { input = JSON.parse(call.function.arguments) as unknown; } catch { throw new Error("OpenRouter returned malformed tool arguments"); }
      return { id: call.id, name: call.function.name, input };
    });
    return {
      content: typeof message.content === "string" ? message.content : "",
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : "stop",
      usage: { inputTokens: data.data.usage?.prompt_tokens, outputTokens: data.data.usage?.completion_tokens, estimatedCostUsd: data.data.usage?.cost },
      providerData: { provider: "openrouter", model: data.data.model ?? model }
    };
  }
}

const ollamaResponseSchema = z.object({ message: z.object({ content: z.string().default(""), tool_calls: z.array(z.object({ id: z.string().optional(), function: z.object({ name: z.string(), arguments: z.unknown() }) })).default([]) }), prompt_eval_count: z.number().optional(), eval_count: z.number().optional() }).passthrough();
const ollamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string().min(1) }).passthrough()) }).passthrough();
const timedOllamaTextFetch = async (fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit, options: ModelRequestOptions, maxBytes: number): Promise<{ response: Response; text: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Ollama request timed out")), options.timeoutMs ?? 60_000);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Ollama response exceeds the ${maxBytes}-byte limit`);
    }
    if (!response.body) return { response, text: "" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`Ollama response exceeds the ${maxBytes}-byte limit`);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { response, text: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "Ollama request cancelled" : "Ollama request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
};
export type OllamaAvailability = { status: "connected"; models: string[] } | { status: "authentication_required" | "rate_limited" | "unsupported" | "unavailable"; models: []; error: string };
export class OllamaAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  constructor(private readonly baseUrl = "http://127.0.0.1:11434", private readonly fetcher: typeof fetch = fetch, private readonly defaultModel?: string) { const url = new URL(baseUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Ollama base URL"); }
  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: true, structuredOutput: true, vision: false, supportsCancellation: true }; }
  async checkAvailability(timeoutMs = 2500): Promise<OllamaAvailability> {
    let response: Response; let text: string;
    try { ({ response, text } = await timedOllamaTextFetch(this.fetcher, new URL("/api/tags", this.baseUrl), { method: "GET" }, { timeoutMs }, 256_000)); }
    catch (error) {
      if (error instanceof Error && error.message.includes("exceeds the")) return { status: "unsupported", models: [], error: "Ollama model-list response exceeded the 256000-byte limit" };
      const message = error instanceof Error && error.message.includes("timed out") ? "Ollama did not respond before the connection check timed out" : "Cannot reach the configured Ollama service";
      return { status: "unavailable", models: [], error: message };
    }
    if (response.status === 401 || response.status === 403) return { status: "authentication_required", models: [], error: "The configured Ollama endpoint requires authentication" };
    if (response.status === 429) return { status: "rate_limited", models: [], error: "The configured Ollama endpoint is rate limited; try again shortly" };
    if (response.status === 404) return { status: "unsupported", models: [], error: "The configured service does not expose the Ollama /api/tags endpoint" };
    if (!response.ok) return { status: "unavailable", models: [], error: `Ollama availability check failed with HTTP ${response.status}` };
    try {
      const data = ollamaTagsSchema.parse(JSON.parse(text) as unknown);
      return { status: "connected", models: data.models.map((model) => model.name) };
    } catch {
      return { status: "unsupported", models: [], error: "Ollama returned an unsupported model-list response" };
    }
  }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel; if (!model) throw new Error("Select an Ollama model id");
    const messages = [{ role: "system", content: request.system }, ...request.messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : message.role, content: message.content, ...(message.toolName ? { tool_name: message.toolName } : {}), ...(message.role === "assistant" && message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.input } })) } : {}) }))];
    const tools = request.tools?.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} } } }));
    const body = JSON.stringify({ model, messages, stream: false, ...(tools?.length ? { tools } : {}) });
    if (new TextEncoder().encode(body).byteLength > 1_000_000) throw new Error("Ollama request exceeds the 1000000-byte limit");
    const { response, text } = await timedOllamaTextFetch(this.fetcher, new URL("/api/chat", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body }, options, 2_000_000);
    if (!response.ok) throw await providerError("Ollama", response);
    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; }
    catch { throw new Error("Ollama returned malformed JSON"); }
    const data = ollamaResponseSchema.parse(payload); const toolCalls: ToolCall[] = data.message.tool_calls.map((call, index) => ({ id: call.id ?? `ollama-call-${index}`, name: call.function.name, input: call.function.arguments }));
    return { content: data.message.content, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count } };
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ModelAdapter>([["mock", new MockModelAdapter()]]);
  get(providerId: string): ModelAdapter { const adapter = this.adapters.get(providerId); if (!adapter) throw new Error(`Provider ${providerId} is not configured`); return adapter; }
  register(adapter: ModelAdapter): void { this.adapters.set(adapter.providerId, adapter); }
  list(): string[] { return [...this.adapters.keys()]; }
}

export type ModelRouteCandidate = { adapter: ModelAdapter; modelId: string; free: boolean };
export type ModelRoutePolicy = { localOnly: boolean; freeOnly: boolean; hostedConsent: boolean };

export class RoutedModelAdapter implements ModelAdapter {
  readonly providerId: string;
  readonly mayUseHostedProvider: boolean;
  lastUsedProviderId: string;
  lastUsedModelId: string;
  constructor(private readonly primary: ModelRouteCandidate, private readonly fallbacks: ModelRouteCandidate[], private readonly policy: ModelRoutePolicy) {
    this.providerId = primary.adapter.providerId;
    this.mayUseHostedProvider = [primary, ...fallbacks].some((candidate) => candidate.adapter.providerId !== "ollama" && candidate.adapter.providerId !== "mock");
    this.lastUsedProviderId = primary.adapter.providerId;
    this.lastUsedModelId = primary.modelId;
    for (const candidate of [primary, ...fallbacks]) this.assertAllowed(candidate);
  }
  getCapabilities(modelId: string): ModelCapabilities { return this.primary.adapter.getCapabilities(modelId || this.primary.modelId); }
  private assertAllowed(candidate: ModelRouteCandidate): void {
    const local = candidate.adapter.providerId === "ollama" || candidate.adapter.providerId === "mock";
    if (this.policy.localOnly && !local) throw new Error("Local-only mode blocks hosted provider requests and fallbacks");
    if (!local && !this.policy.hostedConsent) throw new Error("Explicit hosted-provider consent is required before project context can be sent");
    if (this.policy.freeOnly && !local && !candidate.free) throw new Error("Free-only mode blocks paid or unverified provider models");
  }
  private isFallbackEligible(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /(?:HTTP\s+(?:408|402|429|500|502|503|504)\b|timed? out|network|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN)/i.test(message);
  }
  async generate(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const candidates = [this.primary, ...this.fallbacks];
    const failures: string[] = [];
    for (let index = 0; index < candidates.length; index++) {
      options.signal?.throwIfAborted();
      const candidate = candidates[index]!;
      try {
        const response = await candidate.adapter.generate({ ...request, model: candidate.modelId }, options);
        this.lastUsedProviderId = candidate.adapter.providerId;
        this.lastUsedModelId = typeof response.providerData === "object" && response.providerData !== null && "model" in response.providerData && typeof response.providerData.model === "string"
          ? response.providerData.model
          : candidate.modelId;
        return { ...response, providerData: { ...(typeof response.providerData === "object" && response.providerData !== null ? response.providerData : {}), provider: candidate.adapter.providerId, model: this.lastUsedModelId } };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const detail = error instanceof Error ? error.message.slice(0, 240) : "provider request failed";
        failures.push(`${candidate.adapter.providerId}/${candidate.modelId}: ${detail}`);
        if (!this.isFallbackEligible(error)) {
          if (failures.length === 1) throw error;
          throw new Error(`Fallback stopped after a non-retryable provider error. ${failures.join("; ")}`);
        }
        if (index === candidates.length - 1) throw new Error(`All explicitly allowed provider routes failed. ${failures.join("; ")}`);
      }
    }
    throw new Error(`All explicitly allowed provider routes failed. ${failures.join("; ")}`);
  }
}
