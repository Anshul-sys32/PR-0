import { describe, expect, it } from "vitest";
import { AgentExecutor } from "@pr-0/agent-core";
import type { AgentTask } from "@pr-0/shared";
import type { ModelAdapter, ModelRequest, ModelResponse } from "@pr-0/model-gateway";

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
});
