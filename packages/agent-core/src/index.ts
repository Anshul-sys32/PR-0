import { agentResultSchema, type AgentResult, type AgentTask } from "@pr-0/shared";
import type { ModelAdapter, ModelMessage } from "@pr-0/model-gateway";

export interface AgentTool { name: string; description: string; parameters: Record<string, unknown>; inputSchema: { parse(input: unknown): unknown } }
export interface ExecutionContext { systemPrompt: string; modelId?: string; tools?: AgentTool[]; executeTool?: (name: string, input: unknown) => Promise<unknown>; maxSteps?: number; onUsage?: (usage: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }) => void; }
export class AgentExecutor {
  constructor(private readonly model: ModelAdapter) {}
  async execute(task: AgentTask, context: ExecutionContext): Promise<AgentResult> {
    const messages: ModelMessage[] = [{ role: "user", content: task.description }];
    const tools = context.tools ?? []; const maxSteps = Math.min(Math.max(context.maxSteps ?? 10, 1), 40); const blockers: string[] = [];
    let summary = ""; let step = 0;
    for (; step < maxSteps; step++) {
      const response = await this.model.generate({ model: context.modelId, system: context.systemPrompt, messages, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) });
      context.onUsage?.(response.usage); summary = response.content;
      if (!response.toolCalls.length) break;
      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls, providerData: response.providerData });
      for (const call of response.toolCalls) {
        const tool = tools.find((candidate) => candidate.name === call.name);
        if (!tool || !context.executeTool) {
          blockers.push(`Tool ${call.name} is not available to this agent.`);
          continue;
        }
        try {
          const input = tool.inputSchema.parse(call.input);
          const output = await context.executeTool(call.name, input);
          const rendered = typeof output === "string" ? output : JSON.stringify(output);
          messages.push({ role: "tool", content: rendered.slice(0, 100_000), toolCallId: call.id, toolName: call.name });
        } catch (error) {
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
