import { describe, expect, it } from "vitest";
import { AgentExecutor } from "@pr-0/agent-core";
import type { AgentTask } from "@pr-0/shared";
import type { ModelAdapter, ModelRequest, ModelRequestOptions, ModelResponse } from "@pr-0/model-gateway";
import { RoutedModelAdapter } from "@pr-0/model-gateway";

class ScriptedModel implements ModelAdapter {
  readonly providerId = "test";
  readonly requests: ModelRequest[] = [];
  constructor(private readonly responses: ModelResponse[]) {}
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: false }; }
  async generate(request: ModelRequest): Promise<ModelResponse> { this.requests.push(request); const next = this.responses.shift(); if (!next) throw new Error("No scripted response"); return next; }
}

describe("agent tool loop", () => {
  it("validates and dispatches tools, then gives the result back to the model", async () => {
    const model = new ScriptedModel([
      { content: "", toolCalls: [{ id: "read-1", name: "filesystem.read", input: { path: "README.md" } }], finishReason: "tool_calls", usage: { inputTokens: 5, outputTokens: 2 } },
      { content: "README says Project PR-0", toolCalls: [], finishReason: "stop", usage: { inputTokens: 20, outputTokens: 7 } }
    ]);
    const task: AgentTask = { id: "task-1", projectId: "project-1", title: "Inspect README", description: "Read README and summarize it", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    let invocations = 0; let usageCount = 0;
    const result = await new AgentExecutor(model).execute(task, {
      systemPrompt: "Use authorized tools", maxSteps: 4,
      tools: [{ name: "filesystem.read", description: "Read workspace file", parameters: { type: "object" }, inputSchema: { parse(value) { if (typeof value !== "object" || value === null || !("path" in value)) throw new Error("path required"); return value; } } }],
      executeTool: async (_name, input) => { invocations++; expect(input).toEqual({ path: "README.md" }); return { content: "Project PR-0" }; },
      onUsage: () => usageCount++
    });
    expect(result).toMatchObject({ status: "completed", summary: "README says Project PR-0", blockers: [] });
    expect(invocations).toBe(1); expect(usageCount).toBe(2); expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "read-1", toolName: "filesystem.read", content: "{\"content\":\"Project PR-0\"}" });
  });

  it("blocks unavailable tool requests instead of claiming success", async () => {
    const model = new ScriptedModel([{ content: "", toolCalls: [{ id: "x", name: "terminal.run", input: {} }], finishReason: "tool_calls", usage: {} }]);
    const task: AgentTask = { id: "task-2", projectId: "project-1", title: "Run", description: "Run a command", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    const result = await new AgentExecutor(model).execute(task, { systemPrompt: "", tools: [] });
    expect(result.status).toBe("blocked"); expect(result.blockers[0]).toContain("not available");
  });

  it("includes prior conversation turns before the current task", async () => {
    const model = new ScriptedModel([{ content: "Follow-up answer", toolCalls: [], finishReason: "stop", usage: {} }]);
    const task: AgentTask = { id: "task-followup", projectId: "project-1", title: "Follow up", description: "Continue from the previous result", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    await new AgentExecutor(model).execute(task, { systemPrompt: "", history: [{ role: "user", content: "First request" }, { role: "assistant", content: "First response" }] });
    expect(model.requests[0]?.messages).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "Continue from the previous result" }
    ]);
  });

  it("retries transient provider failures only within the configured bound", async () => {
    let attempts = 0;
    const retryEvents: number[] = [];
    const model: ModelAdapter = {
      providerId: "retry-test",
      getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }),
      generate: async (): Promise<ModelResponse> => {
        attempts++;
        if (attempts < 3) throw new Error("Provider HTTP 503: temporarily unavailable");
        return { content: "Recovered", toolCalls: [], finishReason: "stop", usage: {} };
      }
    };
    const task: AgentTask = { id: "task-retry", projectId: "project-1", title: "Retry", description: "Retry a transient outage", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    const result = await new AgentExecutor(model).execute(task, { systemPrompt: "", maxRetries: 2, onRetry: (attempt) => retryEvents.push(attempt) });
    expect(result.summary).toBe("Recovered");
    expect(attempts).toBe(3);
    expect(retryEvents).toEqual([1, 2]);
  });

  it("does not retry deterministic authentication failures", async () => {
    let attempts = 0;
    const model: ModelAdapter = {
      providerId: "auth-test",
      getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }),
      generate: async (): Promise<ModelResponse> => { attempts++; throw new Error("Provider HTTP 401: invalid credentials"); }
    };
    const task: AgentTask = { id: "task-auth", projectId: "project-1", title: "Auth failure", description: "Fail without retry", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    await expect(new AgentExecutor(model).execute(task, { systemPrompt: "", maxRetries: 4 })).rejects.toThrow("401");
    expect(attempts).toBe(1);
  });

  it("does not duplicate tool execution when an explicitly allowed fallback responds", async () => {
    let primaryAttempts = 0;
    const primary: ModelAdapter = {
      providerId: "openrouter",
      getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }),
      generate: async (): Promise<ModelResponse> => { primaryAttempts++; throw new Error("OpenRouter HTTP 429: rate limited"); }
    };
    const fallbackResponses: ModelResponse[] = [
      { content: "", toolCalls: [{ id: "route-read-1", name: "filesystem.read", input: { path: "README.md" } }], finishReason: "tool_calls", usage: {} },
      { content: "Read through local fallback", toolCalls: [], finishReason: "stop", usage: {} }
    ];
    const fallback: ModelAdapter = {
      providerId: "ollama",
      getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }),
      generate: async (): Promise<ModelResponse> => fallbackResponses.shift() ?? { content: "unexpected", toolCalls: [], finishReason: "stop", usage: {} }
    };
    const routed = new RoutedModelAdapter({ adapter: primary, modelId: "openrouter/free", free: true }, [{ adapter: fallback, modelId: "qwen-coder", free: true }], { localOnly: false, freeOnly: true, hostedConsent: true });
    const task: AgentTask = { id: "task-route", projectId: "project-1", title: "Read README", description: "Read README", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    let toolInvocations = 0;
    const result = await new AgentExecutor(routed).execute(task, {
      systemPrompt: "Use registered tools only",
      tools: [{ name: "filesystem.read", description: "Read a workspace file", parameters: {}, inputSchema: { parse: (value) => value } }],
      executeTool: async () => { toolInvocations++; return "README contents"; }
    });
    expect(result.summary).toBe("Read through local fallback");
    expect(toolInvocations).toBe(1);
    expect(primaryAttempts).toBe(2);
  });

  it("passes cancellation to the provider and stops before dispatching tools", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const model: ModelAdapter = {
      providerId: "abortable-test",
      getCapabilities: () => ({ streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }),
      generate: async (_request: ModelRequest, options?: ModelRequestOptions) => {
        markStarted();
        return new Promise<ModelResponse>((_resolve, reject) => {
          if (options?.signal?.aborted) { reject(options.signal.reason); return; }
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      }
    };
    const task: AgentTask = { id: "task-cancel", projectId: "project-1", title: "Cancel", description: "Cancel this task", role: "orchestrator", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0, createdAt: new Date().toISOString() };
    const controller = new AbortController(); let toolCalls = 0;
    const execution = new AgentExecutor(model).execute(task, { systemPrompt: "", signal: controller.signal, tools: [{ name: "example", description: "test", parameters: {}, inputSchema: { parse: (value) => value } }], executeTool: async () => { toolCalls++; return "unexpected"; } });
    await started;
    controller.abort(new Error("cancelled"));
    await expect(execution).rejects.toThrow("cancelled");
    expect(toolCalls).toBe(0);
  });
});
