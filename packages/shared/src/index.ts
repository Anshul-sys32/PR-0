import { z } from "zod";

export const agentRoles = ["orchestrator", "architect", "frontend", "backend", "debugger", "reviewer", "qa", "researcher", "documentation"] as const;
export const projectMemoryKinds = ["fact", "decision", "outcome"] as const;
export const taskStates = ["pending", "ready", "running", "waiting_for_tool", "waiting_for_approval", "blocked", "failed", "completed", "cancelled"] as const;
export const agentTaskSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string().min(1), description: z.string().min(1),
  role: z.enum(agentRoles), dependencies: z.array(z.string()).default([]), acceptanceCriteria: z.array(z.string()).default([]),
  status: z.enum(taskStates), priority: z.number().int().min(0), createdAt: z.string()
});
export const toolCallSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown() });
export const agentResultSchema = z.object({
  taskId: z.string(), status: z.enum(["completed", "failed", "blocked"]), summary: z.string(),
  filesChanged: z.array(z.string()), tests: z.array(z.object({ name: z.string(), passed: z.boolean(), output: z.string().optional() })),
  artifacts: z.array(z.string()), blockers: z.array(z.string()), requiresApproval: z.boolean()
});
export type AgentRole = z.infer<typeof agentTaskSchema>["role"];
export type TaskState = z.infer<typeof agentTaskSchema>["status"];
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ProjectMemoryKind = (typeof projectMemoryKinds)[number];

export const projectMemoryInputSchema = z.object({ kind: z.enum(projectMemoryKinds), content: z.string().trim().min(1).max(4000) });
export const todoInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).default(""),
  priority: z.number().int().min(0).max(100).default(0),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  status: z.enum(["open", "completed"]).default("open")
});

export const createProjectSchema = z.object({ name: z.string().trim().min(1).max(120), rootPath: z.string().trim().min(1).max(4096) });
export const createConversationSchema = z.object({ projectId: z.string() });
export const createMessageSchema = z.object({ content: z.string().trim().min(1).max(20_000), mode: z.enum(["ask-first", "supervised", "autonomous"]).default("supervised"), role: z.enum(agentRoles).default("orchestrator"), dependencies: z.array(z.string().min(1).max(100)).max(20).default([]) }).refine((message) => new Set(message.dependencies).size === message.dependencies.length, { message: "Dependencies must be unique", path: ["dependencies"] });
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(20_000),
  role: z.enum(agentRoles).default("orchestrator"),
  dependencies: z.array(z.string().min(1).max(100)).max(20).default([]),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  priority: z.number().int().min(0).max(100).default(0)
}).refine((task) => new Set(task.dependencies).size === task.dependencies.length, { message: "Dependencies must be unique", path: ["dependencies"] });
export const planTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(20_000),
  role: z.enum(agentRoles),
  dependsOn: z.array(z.number().int().min(0)).max(11),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  priority: z.number().int().min(0).max(100).default(0)
});
export const taskPlanSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  tasks: z.array(planTaskSchema).min(2).max(12)
}).superRefine((plan, context) => {
  plan.tasks.forEach((task, index) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) context.addIssue({ code: "custom", path: ["tasks", index, "dependsOn"], message: "Task dependencies must be unique" });
    for (const dependency of task.dependsOn) {
      if (dependency >= index) context.addIssue({ code: "custom", path: ["tasks", index, "dependsOn"], message: "Dependencies must point to an earlier task to keep the plan acyclic" });
    }
  });
});
export const createPlanRequestSchema = z.object({
  description: z.string().trim().min(1).max(20_000),
  providerId: z.enum(["mock", "openai", "anthropic", "gemini", "ollama"]).default("mock"),
  modelId: z.string().trim().min(1).max(120).optional()
});
export type PlannedTask = z.infer<typeof planTaskSchema>;
export type TaskPlan = z.infer<typeof taskPlanSchema>;
export const approveSchema = z.object({ approved: z.boolean() });
export const writeFileSchema = z.object({
  taskId: z.string(), projectId: z.string(), path: z.string().trim().min(1).max(1024), content: z.string().max(200_000),
  overwrite: z.boolean().default(false), mode: z.enum(["ask-first", "supervised", "autonomous"]).default("supervised")
});
export type WriteFileRequest = z.infer<typeof writeFileSchema>;
export const terminalStartSchema = z.object({
  taskId: z.string(), projectId: z.string(), workingDirectory: z.string().trim().min(1).max(1024).default("."),
  executable: z.enum(["node", "npm", "npx", "git"]), args: z.array(z.string().max(4096)).max(40).default([]),
  mode: z.enum(["ask-first", "supervised", "autonomous"]).default("supervised")
});
export type TerminalStartRequest = z.infer<typeof terminalStartSchema>;
export const runTaskSchema = z.object({ providerId: z.enum(["mock", "openai", "anthropic", "gemini", "ollama"]).default("mock"), modelId: z.string().trim().min(1).max(120).optional() }).default({ providerId: "mock" });
export const filesystemReadInputSchema = z.object({ path: z.string().trim().min(1).max(1024) });
export const filesystemListInputSchema = z.object({ path: z.string().trim().min(1).max(1024).default("."), maxEntries: z.number().int().min(1).max(500).default(200) });
export const filesystemSearchInputSchema = z.object({ query: z.string().trim().min(1).max(500), path: z.string().trim().min(1).max(1024).default("."), maxResults: z.number().int().min(1).max(100).default(50) });
export const transitionMap: Record<TaskState, TaskState[]> = {
  pending: ["ready", "blocked", "cancelled"], ready: ["running", "blocked", "cancelled"], running: ["waiting_for_tool", "waiting_for_approval", "completed", "failed", "blocked", "cancelled"],
  waiting_for_tool: ["running", "failed", "cancelled"], waiting_for_approval: ["running", "cancelled", "failed"], blocked: [], failed: [], completed: [], cancelled: []
};
export function canTransition(from: TaskState, to: TaskState): boolean { return transitionMap[from].includes(to); }
