import { agentResultSchema, type AgentResult, type AgentTask } from "@pr-0/shared";
import type { ModelAdapter, ModelMessage } from "@pr-0/model-gateway";
export { loadAgentPrompt } from "./prompts.js";

const waitForRetry = (milliseconds: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Execution cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
});

export interface AgentTool { name: string; description: string; parameters: Record<string, unknown>; inputSchema: { parse(input: unknown): unknown } }
export interface ExecutionContext { systemPrompt: string; modelId?: string; history?: ModelMessage[]; tools?: AgentTool[]; executeTool?: (name: string, input: unknown) => Promise<unknown>; maxSteps?: number; maxRetries?: number; signal?: AbortSignal; onUsage?: (usage: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }) => void; onRetry?: (attempt: number) => void; }
export class AgentExecutor {
  constructor(private readonly model: ModelAdapter) {}
  async execute(task: AgentTask, context: ExecutionContext): Promise<AgentResult> {
    const messages: ModelMessage[] = [...(context.history ?? []), { role: "user", content: task.description }];
    const tools = context.tools ?? []; const maxSteps = Math.min(Math.max(context.maxSteps ?? 10, 1), 40); const blockers: string[] = [];
    let summary = ""; let step = 0; let retriesUsed = 0;
    for (; step < maxSteps; step++) {
      context.signal?.throwIfAborted();
      let response;
      for (;;) {
        try {
          response = await this.model.generate({ model: context.modelId, system: context.systemPrompt, messages, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }, { signal: context.signal });
          break;
        } catch (error) {
          context.signal?.throwIfAborted();
          const detail = error instanceof Error ? error.message : String(error);
          const transient = /(?:HTTP\s+(?:408|429|500|502|503|504)|timed?\s*out|fetch failed|network|ECONNRESET|ECONNREFUSED|EAI_AGAIN)/i.test(detail);
          if (!transient || retriesUsed >= Math.min(Math.max(context.maxRetries ?? 0, 0), 5)) throw error;
          const backoffMs = Math.min(100 * (2 ** retriesUsed), 1_000);
          retriesUsed++;
          context.onRetry?.(retriesUsed);
          await waitForRetry(backoffMs, context.signal);
        }
      }
      context.signal?.throwIfAborted();
      context.onUsage?.(response.usage); summary = response.content;
      if (!response.toolCalls.length) break;
      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls, providerData: response.providerData });
      for (const call of response.toolCalls) {
        context.signal?.throwIfAborted();
        const tool = tools.find((candidate) => candidate.name === call.name);
        if (!tool || !context.executeTool) {
          blockers.push(`Tool ${call.name} is not available to this agent.`);
          continue;
        }
        try {
          const input = tool.inputSchema.parse(call.input);
          const output = await context.executeTool(call.name, input);
          context.signal?.throwIfAborted();
          const rendered = typeof output === "string" ? output : JSON.stringify(output);
          messages.push({ role: "tool", content: rendered.slice(0, 100_000), toolCallId: call.id, toolName: call.name });
        } catch (error) {
          context.signal?.throwIfAborted();
          const detail = error instanceof Error ? error.message : "Tool execution failed";
          messages.push({ role: "tool", content: JSON.stringify({ error: detail }).slice(0, 100_000), toolCallId: call.id, toolName: call.name });
        }
      }
      if (blockers.length) break;
    }
    const exceeded = step >= maxSteps;
    if (exceeded) blockers.push(`Tool-call loop reached its ${maxSteps} step limit.`);
    return agentResultSchema.parse({ taskId: task.id, status: blockers.length ? "blocked" : "completed", summary, filesChanged: [], tests: [], artifacts: [], blockers, requiresApproval: false });
  }
}
