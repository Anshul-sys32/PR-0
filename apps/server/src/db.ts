import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { agentResultSchema, taskPlanSchema, type AgentResult, type AgentTask, type ProjectMemoryKind, type TaskPlan, type TaskState } from "@pr-0/shared";

export interface Project { id: string; name: string; rootPath: string; createdAt: string }
export interface Conversation { id: string; projectId: string; createdAt: string }
export interface Message { id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string }
export interface Approval { id: string; taskId: string; action: string; risk: string; status: "pending" | "approved" | "rejected"; createdAt: string }
export interface ApprovalSummary extends Approval { operationKind: PendingOperation["kind"] | null }
export interface PendingOperation { id: string; approvalId: string; kind: "filesystem.write" | "terminal.run"; payload: string; status: "pending" | "executed" | "rejected" | "failed"; createdAt: string }
export interface TerminalSession { id: string; projectId: string; taskId: string; workingDirectory: string; executable: string; args: string[]; status: "running" | "exited" | "failed" | "stopped"; output: string; exitCode: number | null; createdAt: string; updatedAt: string }
export interface TaskExecutionRecord { taskId: string; provider: string; model: string; result: AgentResult; retryAttempts: number; createdAt: string }
export interface ProjectMemory { id: string; projectId: string; kind: ProjectMemoryKind; content: string; createdAt: string; updatedAt: string }
export interface ProjectUsageSummary { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unknownCostRequests: number }
export interface ManualTodo { id: string; projectId: string; title: string; description: string; priority: number; acceptanceCriteria: string[]; status: "open" | "completed"; createdAt: string; updatedAt: string }
export interface PersistedTaskPlan { id: string; projectId: string; description: string; summary: string; provider: string; model: string; createdAt: string; tasks: AgentTask[] }

export class DatabaseService {
  private readonly db: DatabaseSync;
  constructor(url: string) { const path = resolve(url.replace(/^file:/, "")); mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path); this.migrate(); }
  private migrate(): void { this.db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_conversations (task_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, role TEXT NOT NULL, dependencies TEXT NOT NULL, acceptance_criteria TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_operations (id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS terminal_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, working_directory TEXT NOT NULL, executable TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, output TEXT NOT NULL, exit_code INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd REAL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_executions (task_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_retry_attempts (task_id TEXT NOT NULL, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (task_id, attempt));
    CREATE TABLE IF NOT EXISTS project_memory (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS manual_todos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, priority INTEGER NOT NULL, acceptance_criteria TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL, summary TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_plan_tasks (plan_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE, ordinal INTEGER NOT NULL, PRIMARY KEY (plan_id, ordinal));
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  `); }
  recoverInterruptedWork(): { tasks: number; terminalSessions: number } {
    const interrupted = this.db.prepare("SELECT id, project_id AS projectId FROM tasks WHERE status IN ('running', 'waiting_for_tool', 'waiting_for_approval')").all() as Array<{ id: string; projectId: string }>;
    const now = this.now();
    const markTaskFailed = this.db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?");
    const saveResult = this.db.prepare("INSERT INTO task_executions VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, result = excluded.result, created_at = excluded.created_at");
    for (const task of interrupted) {
      markTaskFailed.run(task.id);
      const result: AgentResult = { taskId: task.id, status: "failed", summary: "Task was interrupted when the server stopped.", filesChanged: [], tests: [], artifacts: [], blockers: ["Execution did not finish before server shutdown."], requiresApproval: false };
      saveResult.run(task.id, "system", "unknown", JSON.stringify(result), now);
      this.audit("task.interrupted", JSON.stringify({ taskId: task.id, projectId: task.projectId }));
    }
    const terminalSessions = this.db.prepare("SELECT id FROM terminal_sessions WHERE status = 'running'").all() as Array<{ id: string }>;
    const markSessionStopped = this.db.prepare("UPDATE terminal_sessions SET status = 'failed', updated_at = ? WHERE id = ?");
    for (const session of terminalSessions) {
      markSessionStopped.run(now, session.id);
      this.appendTerminalOutput(session.id, "Session was interrupted when the server stopped.\n");
      this.audit("terminal.interrupted", session.id);
    }
    return { tasks: interrupted.length, terminalSessions: terminalSessions.length };
  }
  private now(): string { return new Date().toISOString(); }
  createProject(name: string, rootPath: string): Project { const value = { id: randomUUID(), name, rootPath, createdAt: this.now() }; this.db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run(value.id, value.name, value.rootPath, value.createdAt); return value; }
  listProjects(): Project[] { return this.db.prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM projects ORDER BY created_at DESC").all() as unknown as Project[]; }
  getProject(id: string): Project | undefined { return this.db.prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM projects WHERE id = ?").get(id) as unknown as Project | undefined; }
  createConversation(projectId: string): Conversation { const value = { id: randomUUID(), projectId, createdAt: this.now() }; this.db.prepare("INSERT INTO conversations VALUES (?, ?, ?)").run(value.id, value.projectId, value.createdAt); return value; }
  getConversation(id: string): Conversation | undefined { return this.db.prepare("SELECT id, project_id AS projectId, created_at AS createdAt FROM conversations WHERE id = ?").get(id) as unknown as Conversation | undefined; }
  listConversations(projectId: string): Conversation[] { return this.db.prepare("SELECT id, project_id AS projectId, created_at AS createdAt FROM conversations WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Conversation[]; }
  linkTaskConversation(taskId: string, conversationId: string): void { this.db.prepare("INSERT OR REPLACE INTO task_conversations VALUES (?, ?)").run(taskId, conversationId); }
  getTaskConversationId(taskId: string): string | undefined { const row = this.db.prepare("SELECT conversation_id AS conversationId FROM task_conversations WHERE task_id = ?").get(taskId) as { conversationId: string } | undefined; return row?.conversationId; }
  addMessage(conversationId: string, role: Message["role"], content: string): Message { const value = { id: randomUUID(), conversationId, role, content, createdAt: this.now() }; this.db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run(value.id, value.conversationId, value.role, value.content, value.createdAt); return value; }
  listMessages(conversationId: string): Message[] { return this.db.prepare("SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as unknown as Message[]; }
  createTask(input: Omit<AgentTask, "id" | "createdAt">): AgentTask { const task: AgentTask = { ...input, id: randomUUID(), createdAt: this.now() }; this.db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(task.id, task.projectId, task.title, task.description, task.role, JSON.stringify(task.dependencies), JSON.stringify(task.acceptanceCriteria), task.status, task.priority, task.createdAt); return task; }
  createTaskPlan(projectId: string, description: string, provider: string, model: string, untrustedPlan: unknown): PersistedTaskPlan {
    const plan = taskPlanSchema.parse(untrustedPlan);
    const id = randomUUID(); const createdAt = this.now(); const createdTasks: AgentTask[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO task_plans VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, description, plan.summary, provider, model, createdAt);
      const linkTask = this.db.prepare("INSERT INTO task_plan_tasks VALUES (?, ?, ?)");
      for (let ordinal = 0; ordinal < plan.tasks.length; ordinal++) {
        const planned = plan.tasks[ordinal];
        if (!planned) throw new Error("Plan contains an empty task slot");
        const dependencies = planned.dependsOn.map((dependencyIndex) => createdTasks[dependencyIndex]?.id);
        if (dependencies.some((dependencyId) => !dependencyId)) throw new Error("Plan references a task that was not created");
        const task = this.createTask({ projectId, title: planned.title, description: planned.description, role: planned.role, dependencies: dependencies as string[], acceptanceCriteria: planned.acceptanceCriteria, status: dependencies.length ? "pending" : "ready", priority: planned.priority });
        createdTasks.push(task);
        linkTask.run(id, task.id, ordinal);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.audit("task.plan_created", JSON.stringify({ planId: id, projectId, provider, taskCount: createdTasks.length }));
    return { id, projectId, description, summary: plan.summary, provider, model, createdAt, tasks: createdTasks };
  }
  getTaskPlan(planId: string): PersistedTaskPlan | undefined {
    const row = this.db.prepare("SELECT id, project_id AS projectId, description, summary, provider, model, created_at AS createdAt FROM task_plans WHERE id = ?").get(planId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const taskIds = (this.db.prepare("SELECT task_id FROM task_plan_tasks WHERE plan_id = ? ORDER BY ordinal").all(planId) as Array<{ task_id: string }>).map((item) => item.task_id);
    return { id: String(row.id), projectId: String(row.projectId), description: String(row.description), summary: String(row.summary), provider: String(row.provider), model: String(row.model), createdAt: String(row.createdAt), tasks: taskIds.map((id) => this.getTask(id)).filter((task): task is AgentTask => task !== undefined) };
  }
  getTask(id: string): AgentTask | undefined { const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined; return row ? this.toTask(row) : undefined; }
  listTasks(projectId: string): AgentTask[] { return (this.db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[]).map((row) => this.toTask(row)); }
  refreshTaskReadiness(projectId: string): void {
    let changed = true;
    while (changed) {
      changed = false;
      const tasks = this.listTasks(projectId);
      const taskStates = new Map(tasks.map((task) => [task.id, task.status]));
      for (const task of tasks) {
        if (task.status !== "pending") continue;
        const dependencies = task.dependencies.map((id) => taskStates.get(id));
        if (dependencies.some((state) => state === undefined || state === "failed" || state === "blocked" || state === "cancelled")) {
          this.updateTaskState(task.id, "blocked");
          changed = true;
        } else if (dependencies.every((state) => state === "completed")) {
          this.updateTaskState(task.id, "ready");
          changed = true;
        }
      }
    }
  }
  private toTask(row: Record<string, unknown>): AgentTask { return { id: String(row.id), projectId: String(row.project_id), title: String(row.title), description: String(row.description), role: row.role as AgentTask["role"], dependencies: JSON.parse(String(row.dependencies)) as string[], acceptanceCriteria: JSON.parse(String(row.acceptance_criteria)) as string[], status: row.status as TaskState, priority: Number(row.priority), createdAt: String(row.created_at) }; }
  updateTaskState(id: string, status: TaskState): void { this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id); }
  saveTaskExecution(taskId: string, provider: string, model: string, result: AgentResult): TaskExecutionRecord {
    const parsed = agentResultSchema.parse(result);
    if (parsed.taskId !== taskId) throw new Error("Execution result task id does not match");
    const record = { taskId, provider, model, result: parsed, createdAt: this.now() };
    this.db.prepare("INSERT INTO task_executions VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, result = excluded.result, created_at = excluded.created_at")
      .run(record.taskId, record.provider, record.model, JSON.stringify(record.result), record.createdAt);
    return { ...record, retryAttempts: this.getTaskRetryAttempts(taskId) };
  }
  recordTaskRetryAttempt(taskId: string, attempt: number): void { this.db.prepare("INSERT OR IGNORE INTO task_retry_attempts VALUES (?, ?, ?)").run(taskId, attempt, this.now()); }
  getTaskRetryAttempts(taskId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS attempts FROM task_retry_attempts WHERE task_id = ?").get(taskId) as { attempts: number };
    return Number(row.attempts);
  }
  getTaskExecution(taskId: string): TaskExecutionRecord | undefined {
    const row = this.db.prepare("SELECT task_id AS taskId, provider, model, result, created_at AS createdAt FROM task_executions WHERE task_id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { taskId: String(row.taskId), provider: String(row.provider), model: String(row.model), result: agentResultSchema.parse(JSON.parse(String(row.result))), retryAttempts: this.getTaskRetryAttempts(taskId), createdAt: String(row.createdAt) };
  }
  createProjectMemory(projectId: string, kind: ProjectMemoryKind, content: string): ProjectMemory {
    const now = this.now(); const memory: ProjectMemory = { id: randomUUID(), projectId, kind, content, createdAt: now, updatedAt: now };
    this.db.prepare("INSERT INTO project_memory VALUES (?, ?, ?, ?, ?, ?)").run(memory.id, memory.projectId, memory.kind, memory.content, memory.createdAt, memory.updatedAt);
    return memory;
  }
  listProjectMemory(projectId: string): ProjectMemory[] {
    return this.db.prepare("SELECT id, project_id AS projectId, kind, content, created_at AS createdAt, updated_at AS updatedAt FROM project_memory WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200").all(projectId) as unknown as ProjectMemory[];
  }
  updateProjectMemory(projectId: string, id: string, kind: ProjectMemoryKind, content: string): ProjectMemory | undefined {
    this.db.prepare("UPDATE project_memory SET kind = ?, content = ?, updated_at = ? WHERE project_id = ? AND id = ?").run(kind, content, this.now(), projectId, id);
    const row = this.db.prepare("SELECT id, project_id AS projectId, kind, content, created_at AS createdAt, updated_at AS updatedAt FROM project_memory WHERE project_id = ? AND id = ?").get(projectId, id);
    return row as unknown as ProjectMemory | undefined;
  }
  deleteProjectMemory(projectId: string, id: string): boolean { return this.db.prepare("DELETE FROM project_memory WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0; }
  findRelevantProjectMemory(projectId: string, query: string, limit = 3): ProjectMemory[] {
    const terms = new Set((query.toLocaleLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((term) => !["the", "and", "for", "with", "from", "this", "that", "are", "you"].includes(term)));
    if (!terms.size) return [];
    return this.listProjectMemory(projectId).map((memory) => {
      const text = `${memory.kind} ${memory.content}`.toLocaleLowerCase();
      const score = [...terms].reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
      return { memory, score };
    }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt)).slice(0, limit).map((item) => item.memory);
  }
  addUsage(taskId: string, usage: { provider?: string; model?: string; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }): void { this.db.prepare("INSERT INTO usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), taskId, usage.provider ?? "unknown", usage.model ?? "unknown", usage.inputTokens ?? null, usage.outputTokens ?? null, usage.estimatedCostUsd ?? null, this.now()); }
  getProjectUsage(projectId: string): ProjectUsageSummary {
    const row = this.db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd, SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests FROM usage_records u JOIN tasks t ON t.id = u.task_id WHERE t.project_id = ?`).get(projectId) as Record<string, number>;
    return { requests: Number(row.requests), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), estimatedCostUsd: Number(row.estimatedCostUsd), unknownCostRequests: Number(row.unknownCostRequests) };
  }
  createTodo(projectId: string, input: Omit<ManualTodo, "id" | "projectId" | "createdAt" | "updatedAt">): ManualTodo {
    const now = this.now(); const todo: ManualTodo = { id: randomUUID(), projectId, ...input, createdAt: now, updatedAt: now };
    this.db.prepare("INSERT INTO manual_todos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(todo.id, todo.projectId, todo.title, todo.description, todo.priority, JSON.stringify(todo.acceptanceCriteria), todo.status, todo.createdAt, todo.updatedAt);
    return todo;
  }
  listTodos(projectId: string): ManualTodo[] {
    return (this.db.prepare("SELECT id, project_id AS projectId, title, description, priority, acceptance_criteria AS acceptanceCriteria, status, created_at AS createdAt, updated_at AS updatedAt FROM manual_todos WHERE project_id = ? ORDER BY status ASC, priority DESC, created_at DESC").all(projectId) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), projectId: String(row.projectId), title: String(row.title), description: String(row.description), priority: Number(row.priority), acceptanceCriteria: JSON.parse(String(row.acceptanceCriteria)) as string[], status: row.status as ManualTodo["status"], createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) }));
  }
  updateTodo(projectId: string, id: string, input: Omit<ManualTodo, "id" | "projectId" | "createdAt" | "updatedAt">): ManualTodo | undefined {
    this.db.prepare("UPDATE manual_todos SET title = ?, description = ?, priority = ?, acceptance_criteria = ?, status = ?, updated_at = ? WHERE project_id = ? AND id = ?").run(input.title, input.description, input.priority, JSON.stringify(input.acceptanceCriteria), input.status, this.now(), projectId, id);
    return this.listTodos(projectId).find((todo) => todo.id === id);
  }
  deleteTodo(projectId: string, id: string): boolean { return this.db.prepare("DELETE FROM manual_todos WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0; }
  createApproval(taskId: string, action: string, risk: string): Approval { const approval: Approval = { id: randomUUID(), taskId, action, risk, status: "pending", createdAt: this.now() }; this.db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?)").run(approval.id, approval.taskId, approval.action, approval.risk, approval.status, approval.createdAt); return approval; }
  getApproval(id: string): Approval | undefined { return this.db.prepare("SELECT id, task_id AS taskId, action, risk, status, created_at AS createdAt FROM approvals WHERE id = ?").get(id) as unknown as Approval | undefined; }
  listPendingApprovals(projectId: string): ApprovalSummary[] {
    return this.db.prepare("SELECT a.id, a.task_id AS taskId, a.action, a.risk, a.status, a.created_at AS createdAt, p.kind AS operationKind FROM approvals a JOIN tasks t ON t.id = a.task_id LEFT JOIN pending_operations p ON p.approval_id = a.id WHERE t.project_id = ? AND a.status = 'pending' ORDER BY a.created_at ASC")
      .all(projectId) as unknown as ApprovalSummary[];
  }
  decideApproval(id: string, approved: boolean): void { this.db.prepare("UPDATE approvals SET status = ? WHERE id = ?").run(approved ? "approved" : "rejected", id); }
  createPendingOperation(approvalId: string, kind: PendingOperation["kind"], payload: string): PendingOperation { const operation = { id: randomUUID(), approvalId, kind, payload, status: "pending" as const, createdAt: this.now() }; this.db.prepare("INSERT INTO pending_operations VALUES (?, ?, ?, ?, ?, ?)").run(operation.id, operation.approvalId, operation.kind, operation.payload, operation.status, operation.createdAt); return operation; }
  getPendingOperationByApproval(approvalId: string): PendingOperation | undefined { return this.db.prepare("SELECT id, approval_id AS approvalId, kind, payload, status, created_at AS createdAt FROM pending_operations WHERE approval_id = ?").get(approvalId) as unknown as PendingOperation | undefined; }
  updatePendingOperation(id: string, status: PendingOperation["status"]): void { this.db.prepare("UPDATE pending_operations SET status = ? WHERE id = ?").run(status, id); }
  createTerminalSession(input: Omit<TerminalSession, "id" | "status" | "output" | "exitCode" | "createdAt" | "updatedAt">): TerminalSession { const now = this.now(); const session: TerminalSession = { id: randomUUID(), ...input, status: "running", output: "", exitCode: null, createdAt: now, updatedAt: now }; this.db.prepare("INSERT INTO terminal_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(session.id, session.projectId, session.taskId, session.workingDirectory, session.executable, JSON.stringify(session.args), session.status, session.output, session.exitCode, session.createdAt, session.updatedAt); return session; }
  getTerminalSession(id: string): TerminalSession | undefined { const row = this.db.prepare("SELECT * FROM terminal_sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined; return row ? this.toTerminalSession(row) : undefined; }
  listTerminalSessions(projectId: string): TerminalSession[] { return (this.db.prepare("SELECT * FROM terminal_sessions WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[]).map((row) => this.toTerminalSession(row)); }
  appendTerminalOutput(id: string, chunk: string, maxBytes = 200_000): void { const current = this.getTerminalSession(id); if (!current) return; const output = (current.output + chunk).slice(-maxBytes); this.db.prepare("UPDATE terminal_sessions SET output = ?, updated_at = ? WHERE id = ?").run(output, this.now(), id); }
  finishTerminalSession(id: string, status: TerminalSession["status"], exitCode: number | null): void { this.db.prepare("UPDATE terminal_sessions SET status = ?, exit_code = ?, updated_at = ? WHERE id = ?").run(status, exitCode, this.now(), id); }
  private toTerminalSession(row: Record<string, unknown>): TerminalSession { return { id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id), workingDirectory: String(row.working_directory), executable: String(row.executable), args: JSON.parse(String(row.args)) as string[], status: row.status as TerminalSession["status"], output: String(row.output), exitCode: row.exit_code === null ? null : Number(row.exit_code), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
  audit(kind: string, detail: string): void { this.db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?)").run(randomUUID(), kind, detail.slice(0, 5000), this.now()); }
  close(): void { this.db.close(); }
}
