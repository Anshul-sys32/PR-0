import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AgentTask, TaskState } from "@pr-0/shared";

export interface Project { id: string; name: string; rootPath: string; createdAt: string }
export interface Conversation { id: string; projectId: string; createdAt: string }
export interface Message { id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string }
export interface Approval { id: string; taskId: string; action: string; risk: string; status: "pending" | "approved" | "rejected"; createdAt: string }
export interface PendingOperation { id: string; approvalId: string; kind: "filesystem.write" | "terminal.run"; payload: string; status: "pending" | "executed" | "rejected" | "failed"; createdAt: string }
export interface TerminalSession { id: string; projectId: string; taskId: string; workingDirectory: string; executable: string; args: string[]; status: "running" | "exited" | "failed" | "stopped"; output: string; exitCode: number | null; createdAt: string; updatedAt: string }

export class DatabaseService {
  private readonly db: DatabaseSync;
  constructor(url: string) { const path = resolve(url.replace(/^file:/, "")); mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path); this.migrate(); }
  private migrate(): void { this.db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, role TEXT NOT NULL, dependencies TEXT NOT NULL, acceptance_criteria TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_operations (id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS terminal_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, working_directory TEXT NOT NULL, executable TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, output TEXT NOT NULL, exit_code INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd REAL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  `); }
  private now(): string { return new Date().toISOString(); }
  createProject(name: string, rootPath: string): Project { const value = { id: randomUUID(), name, rootPath, createdAt: this.now() }; this.db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run(value.id, value.name, value.rootPath, value.createdAt); return value; }
  listProjects(): Project[] { return this.db.prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM projects ORDER BY created_at DESC").all() as unknown as Project[]; }
  getProject(id: string): Project | undefined { return this.db.prepare("SELECT id, name, root_path AS rootPath, created_at AS createdAt FROM projects WHERE id = ?").get(id) as unknown as Project | undefined; }
  createConversation(projectId: string): Conversation { const value = { id: randomUUID(), projectId, createdAt: this.now() }; this.db.prepare("INSERT INTO conversations VALUES (?, ?, ?)").run(value.id, value.projectId, value.createdAt); return value; }
  getConversation(id: string): Conversation | undefined { return this.db.prepare("SELECT id, project_id AS projectId, created_at AS createdAt FROM conversations WHERE id = ?").get(id) as unknown as Conversation | undefined; }
  addMessage(conversationId: string, role: Message["role"], content: string): Message { const value = { id: randomUUID(), conversationId, role, content, createdAt: this.now() }; this.db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run(value.id, value.conversationId, value.role, value.content, value.createdAt); return value; }
  listMessages(conversationId: string): Message[] { return this.db.prepare("SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as unknown as Message[]; }
  createTask(input: Omit<AgentTask, "id" | "createdAt">): AgentTask { const task: AgentTask = { ...input, id: randomUUID(), createdAt: this.now() }; this.db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(task.id, task.projectId, task.title, task.description, task.role, JSON.stringify(task.dependencies), JSON.stringify(task.acceptanceCriteria), task.status, task.priority, task.createdAt); return task; }
  getTask(id: string): AgentTask | undefined { const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined; return row ? this.toTask(row) : undefined; }
  listTasks(projectId: string): AgentTask[] { return (this.db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[]).map((row) => this.toTask(row)); }
  private toTask(row: Record<string, unknown>): AgentTask { return { id: String(row.id), projectId: String(row.project_id), title: String(row.title), description: String(row.description), role: row.role as AgentTask["role"], dependencies: JSON.parse(String(row.dependencies)) as string[], acceptanceCriteria: JSON.parse(String(row.acceptance_criteria)) as string[], status: row.status as TaskState, priority: Number(row.priority), createdAt: String(row.created_at) }; }
  updateTaskState(id: string, status: TaskState): void { this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id); }
  addUsage(taskId: string, usage: { provider?: string; model?: string; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }): void { this.db.prepare("INSERT INTO usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), taskId, usage.provider ?? "unknown", usage.model ?? "unknown", usage.inputTokens ?? null, usage.outputTokens ?? null, usage.estimatedCostUsd ?? null, this.now()); }
  createApproval(taskId: string, action: string, risk: string): Approval { const approval: Approval = { id: randomUUID(), taskId, action, risk, status: "pending", createdAt: this.now() }; this.db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?)").run(approval.id, approval.taskId, approval.action, approval.risk, approval.status, approval.createdAt); return approval; }
  getApproval(id: string): Approval | undefined { return this.db.prepare("SELECT id, task_id AS taskId, action, risk, status, created_at AS createdAt FROM approvals WHERE id = ?").get(id) as unknown as Approval | undefined; }
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
