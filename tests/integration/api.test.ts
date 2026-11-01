import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../../apps/server/src/app.js";
import { DatabaseService } from "../../apps/server/src/db.js";
import type { FastifyInstance } from "fastify";
import type { ModelAdapter, ModelRequest, ModelRequestOptions, ModelResponse } from "@pr-0/model-gateway";

class AbortableTestAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  readonly requests: ModelRequest[] = [];
  private markStarted!: () => void;
  readonly started = new Promise<void>((resolve) => { this.markStarted = resolve; });
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }; }
  async generate(request: ModelRequest, options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    this.markStarted();
    return new Promise<ModelResponse>((_resolve, reject) => {
      if (options?.signal?.aborted) { reject(options.signal.reason); return; }
      options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  }
}

class RecordingModelAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  readonly requests: ModelRequest[] = [];
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }; }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return { content: `Response to ${request.messages.at(-1)?.content ?? ""}`, toolCalls: [], finishReason: "stop", usage: {} };
  }
}

class RetryingTestAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  attempts = 0;
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }; }
  async generate(): Promise<ModelResponse> {
    this.attempts++;
    if (this.attempts < 3) throw new Error("Provider HTTP 503: temporarily unavailable");
    return { content: "Recovered after transient failures", toolCalls: [], finishReason: "stop", usage: {} };
  }
}

class PlanResponseAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  constructor(private readonly content: string) {}
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }; }
  async generate(): Promise<ModelResponse> { return { content: this.content, toolCalls: [], finishReason: "stop", usage: { inputTokens: 25, outputTokens: 40 } }; }
}

class ConcurrentPlanAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  activeTaskCalls = 0;
  maxConcurrentTaskCalls = 0;
  constructor(private readonly pause: (milliseconds: number) => Promise<void>) {}
  getCapabilities() { return { streaming: false, toolCalling: true, structuredOutput: false, vision: false, supportsCancellation: true }; }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.system.includes("You are a task planner.")) return {
      content: JSON.stringify({ summary: "Two independent tasks followed by two dependent tasks.", tasks: [
        { title: "Inspect UI", description: "Inspect UI requirements", role: "architect", dependsOn: [], acceptanceCriteria: ["List UI constraints"] },
        { title: "Inspect API", description: "Inspect API requirements", role: "architect", dependsOn: [], acceptanceCriteria: ["List API constraints"] },
        { title: "Implement feature", description: "Implement the feature", role: "backend", dependsOn: [0, 1], acceptanceCriteria: ["Implement behavior"] },
        { title: "Verify feature", description: "Verify the feature", role: "qa", dependsOn: [2], acceptanceCriteria: ["Run checks"] }
      ] }), toolCalls: [], finishReason: "stop", usage: { inputTokens: 10, outputTokens: 50 }
    };
    this.activeTaskCalls++;
    this.maxConcurrentTaskCalls = Math.max(this.maxConcurrentTaskCalls, this.activeTaskCalls);
    await this.pause(20);
    this.activeTaskCalls--;
    return { content: `Finished ${request.messages.at(-1)?.content ?? "task"}`, toolCalls: [], finishReason: "stop", usage: { inputTokens: 5, outputTokens: 5 } };
  }
}

let app: FastifyInstance; let directory: string;
beforeAll(async () => { directory = mkdtempSync(join(tmpdir(), "pr0-test-")); app = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "test.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 3, MAX_TOOL_STEPS_PER_TASK: 40 }, undefined, [new AbortableTestAdapter()]); });
afterAll(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
describe("local workflow", () => {
  it("persists and runs a mock task", async () => {
    expect((await app.inject("/health")).json().ok).toBe(true);
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "test", rootPath: directory } })).json().project;
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { name: "escape", rootPath: `${directory}-other` } })).statusCode).toBe(403);
    symlinkSync("/tmp", join(directory, "workspace-link"));
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { name: "symlink escape", rootPath: join(directory, "workspace-link") } })).statusCode).toBe(403);
    const conversation = (await app.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
    const task = (await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Explain the repository", mode: "supervised" } })).json().task;
    const unconfiguredProvider = await app.inject({ method: "POST", url: `/api/tasks/${task.id}/run`, payload: { providerId: "openai", modelId: "test-model" } });
    expect(unconfiguredProvider.statusCode).toBe(400); expect(unconfiguredProvider.body).toContain("not configured");
    writeFileSync(join(directory, ".env.test"), "TOKEN=do-not-read");
    const secretRead = await app.inject({ method: "POST", url: "/api/files/read", payload: { projectId: project.id, path: ".env.test" } });
    expect(secretRead.statusCode).toBe(400); expect(secretRead.body).not.toContain("do-not-read");
    const providers = await app.inject("/api/providers");
    expect(providers.json().providers.map((provider: { id: string }) => provider.id)).toContain("ollama");
    expect(providers.body).not.toContain("test-secret");
    const queuedWrite = await app.inject({ method: "POST", url: "/api/files/write", payload: { taskId: task.id, projectId: project.id, path: "generated.txt", content: "approved content", mode: "supervised" } });
    expect(queuedWrite.statusCode).toBe(202);
    const approval = queuedWrite.json().approval;
    const pendingApprovals = await app.inject(`/api/projects/${project.id}/approvals`);
    expect(pendingApprovals.json().approvals).toContainEqual(expect.objectContaining({ id: approval.id, action: "Write generated.txt", risk: "consequential", operationKind: "filesystem.write" }));
    expect(pendingApprovals.body).not.toContain("approved content");
    const decision = await app.inject({ method: "POST", url: `/api/approvals/${approval.id}/decision`, payload: { approved: true } });
    expect(decision.statusCode).toBe(200); expect(readFileSync(join(directory, "generated.txt"), "utf8")).toBe("approved content");
    const listing = await app.inject({ method: "POST", url: "/api/files/list", payload: { projectId: project.id, path: ".", maxEntries: 1 } });
    expect(listing.statusCode).toBe(200); expect(listing.json().listing.entries).toHaveLength(1); expect(listing.json().listing.truncated).toBe(true);
    const search = await app.inject({ method: "POST", url: "/api/files/search", payload: { projectId: project.id, query: "approved content" } });
    expect(search.statusCode).toBe(200); expect(search.json().search.results).toContainEqual(expect.objectContaining({ path: "generated.txt", line: 1 }));
    const secretSearch = await app.inject({ method: "POST", url: "/api/files/search", payload: { projectId: project.id, query: "do-not-read" } });
    expect(secretSearch.statusCode).toBe(200); expect(secretSearch.json().search.results).toHaveLength(0);
    const traversalSearch = await app.inject({ method: "POST", url: "/api/files/search", payload: { projectId: project.id, path: "../", query: "anything" } });
    expect(traversalSearch.statusCode).toBe(400);
    const excessiveListing = await app.inject({ method: "POST", url: "/api/files/list", payload: { projectId: project.id, maxEntries: 501 } });
    expect(excessiveListing.statusCode).toBe(400);
    const duplicateWrite = await app.inject({ method: "POST", url: "/api/files/write", payload: { taskId: task.id, projectId: project.id, path: "generated.txt", content: "replacement", mode: "autonomous" } });
    expect(duplicateWrite.statusCode).toBe(400);
    symlinkSync("/tmp", join(directory, "outside-link"));
    const symlinkWrite = await app.inject({ method: "POST", url: "/api/files/write", payload: { taskId: task.id, projectId: project.id, path: "outside-link/escape.txt", content: "blocked", mode: "autonomous" } });
    expect(symlinkWrite.statusCode).toBe(400);
    const queuedTerminal = await app.inject({ method: "POST", url: "/api/terminal-sessions", payload: { taskId: task.id, projectId: project.id, executable: "node", args: ["-e", "process.stdout.write('terminal-ok')"], mode: "supervised" } });
    expect(queuedTerminal.statusCode).toBe(202);
    const terminalDecision = await app.inject({ method: "POST", url: `/api/approvals/${queuedTerminal.json().approval.id}/decision`, payload: { approved: true } });
    expect(terminalDecision.statusCode).toBe(200);
    const sessionId = terminalDecision.json().result.session.id;
    await delay(100);
    const terminalSession = await app.inject(`/api/terminal-sessions/${sessionId}`);
    expect(["exited", "failed"]).toContain(terminalSession.json().session.status);
    const run = await app.inject({ method: "POST", url: `/api/tasks/${task.id}/run` });
    expect(run.statusCode).toBe(200); expect(run.json().result.status).toBe("completed");
    const persistedTask = (await app.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((value: { id: string }) => value.id === task.id);
    expect(persistedTask.status).toBe("completed");
    expect(persistedTask.execution).toMatchObject({ provider: "mock", model: "mock", result: { taskId: task.id, status: "completed", summary: expect.stringContaining("Mock provider received") } });
    const conversationMessages = (await app.inject(`/api/conversations/${conversation.id}/messages`)).json().messages;
    expect(conversationMessages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
    expect(conversationMessages[1].content).toContain("Mock provider received");
    expect((await app.inject(`/api/projects/${project.id}/conversations`)).json().conversations).toContainEqual(expect.objectContaining({ id: conversation.id }));
    expect((await app.inject(`/api/projects/${project.id}/usage`)).json().usage).toMatchObject({ requests: 1, outputTokens: 16, estimatedCostUsd: 0, unknownCostRequests: 0 });
    const followup = (await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Now summarize the next step" } })).json().task;
    const followupRun = await app.inject({ method: "POST", url: `/api/tasks/${followup.id}/run`, payload: { providerId: "mock" } });
    expect(followupRun.statusCode).toBe(200);
    const multiTurnMessages = (await app.inject(`/api/conversations/${conversation.id}/messages`)).json().messages;
    expect(multiTurnMessages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("supports project memory CRUD and rejects credential-like values", async () => {
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "memory-test", rootPath: directory } })).json().project;
    const created = await app.inject({ method: "POST", url: `/api/projects/${project.id}/memory`, payload: { kind: "fact", content: "The service stores local tasks in SQLite." } });
    expect(created.statusCode).toBe(201);
    const memoryId = created.json().memory.id;
    const rejectedSecret = await app.inject({ method: "POST", url: `/api/projects/${project.id}/memory`, payload: { kind: "fact", content: "OPENAI_API_KEY=sk-example-secret-value" } });
    expect(rejectedSecret.statusCode).toBe(400);
    const updated = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/memory/${memoryId}`, payload: { kind: "decision", content: "SQLite remains the local persistence layer." } });
    expect(updated.statusCode).toBe(200); expect(updated.json().memory.kind).toBe("decision");
    expect((await app.inject(`/api/projects/${project.id}/memory`)).json().memories).toContainEqual(expect.objectContaining({ id: memoryId, content: "SQLite remains the local persistence layer." }));
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${project.id}/memory/${memoryId}` })).statusCode).toBe(200);
    expect((await app.inject(`/api/projects/${project.id}/memory`)).json().memories).toHaveLength(0);
  });

  it("keeps manual TODOs separate from execution task state", async () => {
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "todo-test", rootPath: directory } })).json().project;
    const created = await app.inject({ method: "POST", url: `/api/projects/${project.id}/todos`, payload: { title: "Review generated API", description: "Human-owned follow-up", priority: 8, acceptanceCriteria: ["Review behavior"] } });
    expect(created.statusCode).toBe(201);
    const todoId = created.json().todo.id;
    const conversation = (await app.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
    const task = (await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Explain a file" } })).json().task;
    await app.inject({ method: "POST", url: `/api/tasks/${task.id}/run`, payload: { providerId: "mock" } });
    const listed = (await app.inject(`/api/projects/${project.id}/todos`)).json().todos;
    expect(listed).toContainEqual(expect.objectContaining({ id: todoId, status: "open", priority: 8 }));
    const completed = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/todos/${todoId}`, payload: { title: "Review generated API", description: "Done", priority: 8, acceptanceCriteria: ["Review behavior"], status: "completed" } });
    expect(completed.json().todo.status).toBe("completed");
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${project.id}/todos/${todoId}` })).statusCode).toBe(200);
  });

  it("recovers persisted running tasks and terminal sessions after a server restart", async () => {
    const databaseUrl = `file:${join(directory, "recovery.db")}`;
    const initialDatabase = new DatabaseService(databaseUrl);
    const project = initialDatabase.createProject("recovery-test", directory);
    const task = initialDatabase.createTask({ projectId: project.id, title: "Interrupted task", description: "Must report interruption", role: "backend", dependencies: [], acceptanceCriteria: [], status: "running", priority: 0 });
    const session = initialDatabase.createTerminalSession({ projectId: project.id, taskId: task.id, workingDirectory: directory, executable: "node", args: ["long-running"] });
    initialDatabase.close();
    const recoveryApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: databaseUrl, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 3, MAX_TOOL_STEPS_PER_TASK: 40, MAX_RETRIES_PER_TASK: 3 });
    try {
      const tasks = (await recoveryApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks;
      expect(tasks.find((value: { id: string }) => value.id === task.id)).toMatchObject({ status: "failed", execution: { result: { status: "failed", summary: "Task was interrupted when the server stopped." } } });
      const recoveredSession = (await recoveryApp.inject(`/api/terminal-sessions/${session.id}`)).json().session;
      expect(recoveredSession.status).toBe("failed");
      expect(recoveredSession.output).toContain("Session was interrupted");
    } finally {
      await recoveryApp.close();
    }
  });

  it("holds dependent tasks until prerequisites complete", async () => {
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "dependency-test", rootPath: directory } })).json().project;
    const conversation = (await app.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
    const prerequisite = (await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Prepare the foundation" } })).json().task;
    const dependentResponse = await app.inject({ method: "POST", url: `/api/projects/${project.id}/tasks`, payload: { title: "Build on the foundation", description: "Wait for the prerequisite", dependencies: [prerequisite.id] } });
    expect(dependentResponse.statusCode).toBe(201);
    const dependent = dependentResponse.json().task;
    expect(dependent.status).toBe("pending");
    const composerDependent = (await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Implement the frontend after setup", role: "frontend", dependencies: [prerequisite.id] } })).json().task;
    expect(composerDependent).toMatchObject({ role: "frontend", status: "pending", dependencies: [prerequisite.id] });
    const invalidDependency = await app.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Do not save this", dependencies: ["task-from-another-project"] } });
    expect(invalidDependency.statusCode).toBe(400);
    const prematureRun = await app.inject({ method: "POST", url: `/api/tasks/${dependent.id}/run`, payload: { providerId: "mock" } });
    expect(prematureRun.statusCode).toBe(409);
    expect(prematureRun.json().dependencies).toContain(prerequisite.id);
    const completedPrerequisite = await app.inject({ method: "POST", url: `/api/tasks/${prerequisite.id}/run`, payload: { providerId: "mock" } });
    expect(completedPrerequisite.statusCode).toBe(200);
    const releasedDependent = (await app.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((task: { id: string }) => task.id === dependent.id);
    expect(releasedDependent.status).toBe("ready");
    const releasedComposerTask = (await app.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((task: { id: string }) => task.id === composerDependent.id);
    expect(releasedComposerTask.status).toBe("ready");
    const dependentRun = await app.inject({ method: "POST", url: `/api/tasks/${dependent.id}/run`, payload: { providerId: "mock" } });
    expect(dependentRun.statusCode).toBe(200);
  });

  it("generates and persists a deterministic mock task plan", async () => {
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "plan-test", rootPath: directory } })).json().project;
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/plan`, payload: { description: "Build a project settings page" } });
    expect(response.statusCode).toBe(201);
    const plan = response.json().plan;
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks.map((task: { status: string }) => task.status)).toEqual(["ready", "pending", "pending"]);
    expect(plan.tasks[1].dependencies).toEqual([plan.tasks[0].id]);
    expect(plan.tasks[2].dependencies).toEqual([plan.tasks[1].id]);
    expect(plan.provider).toBe("mock");
    expect((await app.inject(`/api/projects/${project.id}/tasks`)).json().tasks).toHaveLength(3);
  });

  it("runs independent plan tasks concurrently within the configured limit", async () => {
    const adapter = new ConcurrentPlanAdapter((milliseconds) => delay(milliseconds));
    const planApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "parallel-plan.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 2, MAX_TOOL_STEPS_PER_TASK: 40, MAX_RETRIES_PER_TASK: 1 }, undefined, [adapter]);
    try {
      const project = (await planApp.inject({ method: "POST", url: "/api/projects", payload: { name: "parallel-plan", rootPath: directory } })).json().project;
      const generated = await planApp.inject({ method: "POST", url: `/api/projects/${project.id}/plan`, payload: { description: "Implement and verify a dashboard feature", providerId: "ollama", modelId: "test-model" } });
      expect(generated.statusCode).toBe(201);
      const planId = generated.json().plan.id;
      const started = await planApp.inject({ method: "POST", url: `/api/task-plans/${planId}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(started.statusCode).toBe(202);
      const duplicateStart = await planApp.inject({ method: "POST", url: `/api/task-plans/${planId}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(duplicateStart.statusCode).toBe(409);
      expect(duplicateStart.json().error).toContain("already running");
      let state = (await planApp.inject(`/api/task-plans/${planId}`)).json().plan;
      for (let attempt = 0; attempt < 100 && state.tasks.some((task: { status: string }) => !["completed", "failed", "blocked", "cancelled"].includes(task.status)); attempt++) {
        await delay(10);
        state = (await planApp.inject(`/api/task-plans/${planId}`)).json().plan;
      }
      expect(state.tasks.map((task: { status: string }) => task.status)).toEqual(["completed", "completed", "completed", "completed"]);
      expect(adapter.maxConcurrentTaskCalls).toBe(2);
    } finally { await planApp.close(); }
  });

  it("streams task-plan progress as scheduler statuses change", async () => {
    const adapter = new ConcurrentPlanAdapter((milliseconds) => delay(milliseconds));
    const streamApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "plan-events.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 2, MAX_TOOL_STEPS_PER_TASK: 40, MAX_RETRIES_PER_TASK: 1 }, undefined, [adapter]);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const project = (await streamApp.inject({ method: "POST", url: "/api/projects", payload: { name: "plan-events", rootPath: directory } })).json().project;
      const generated = await streamApp.inject({ method: "POST", url: `/api/projects/${project.id}/plan`, payload: { description: "Implement and verify a dashboard feature", providerId: "ollama", modelId: "test-model" } });
      const planId = generated.json().plan.id as string;
      const address = await streamApp.listen({ host: "127.0.0.1", port: 0 });
      const response = await fetch(`${address}/api/task-plans/${planId}/events`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      reader = response.body?.getReader();
      if (!reader) throw new Error("Plan event stream did not provide a response body");
      let buffer = "";
      const readPlanEvent = async () => {
        while (!buffer.includes("\n\n")) {
          const next = await reader?.read();
          if (!next || next.done) throw new Error("Plan event stream ended before a complete event arrived");
          buffer += new TextDecoder().decode(next.value);
        }
        const [event, ...rest] = buffer.split("\n\n");
        buffer = rest.join("\n\n");
        const data = event?.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (!data) throw new Error("Plan progress event did not contain data");
        return JSON.parse(data) as { plan: { tasks: Array<{ status: string }> } };
      };
      const initial = await readPlanEvent();
      expect(initial.plan.tasks.map((task) => task.status)).toEqual(["ready", "ready", "pending", "pending"]);
      const started = await streamApp.inject({ method: "POST", url: `/api/task-plans/${planId}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(started.statusCode).toBe(202);
      let latest = initial;
      for (let attempt = 0; attempt < 20 && latest.plan.tasks.some((task) => task.status !== "completed" && task.status !== "failed" && task.status !== "blocked" && task.status !== "cancelled"); attempt++) {
        latest = await readPlanEvent();
      }
      expect(latest.plan.tasks.map((task) => task.status)).toEqual(["completed", "completed", "completed", "completed"]);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await streamApp.close();
    }
  });

  it("persists transient provider retry attempts and returns their count", async () => {
    const databaseUrl = `file:${join(directory, "retry-accounting.db")}`;
    const adapter = new RetryingTestAdapter();
    const retryApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: databaseUrl, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 1, MAX_TOOL_STEPS_PER_TASK: 40, MAX_RETRIES_PER_TASK: 2 }, undefined, [adapter]);
    let taskId = "";
    try {
      const project = (await retryApp.inject({ method: "POST", url: "/api/projects", payload: { name: "retry-accounting", rootPath: directory } })).json().project;
      const conversation = (await retryApp.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
      const task = (await retryApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Retry transient provider errors" } })).json().task;
      taskId = task.id;
      const run = await retryApp.inject({ method: "POST", url: `/api/tasks/${task.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(run.statusCode).toBe(200);
      expect(adapter.attempts).toBe(3);
      const savedTask = (await retryApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((value: { id: string }) => value.id === task.id);
      expect(savedTask).toMatchObject({ status: "completed", retryAttempts: 2, execution: { retryAttempts: 2, result: { status: "completed" } } });
    } finally { await retryApp.close(); }
    const reopenedDatabase = new DatabaseService(databaseUrl);
    try { expect(reopenedDatabase.getTaskRetryAttempts(taskId)).toBe(2); expect(reopenedDatabase.getTaskExecution(taskId)?.retryAttempts).toBe(2); }
    finally { reopenedDatabase.close(); }
  });

  it("rejects malformed or cyclic model plans before persisting task rows", async () => {
    const invalidPlan = JSON.stringify({ summary: "invalid", tasks: [
      { title: "First", description: "First task", role: "architect", dependsOn: [1], acceptanceCriteria: ["Inspect"] },
      { title: "Second", description: "Second task", role: "backend", dependsOn: [0], acceptanceCriteria: ["Implement"] }
    ] });
    const adapter = new PlanResponseAdapter(invalidPlan);
    const planApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "invalid-plan.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 3, MAX_TOOL_STEPS_PER_TASK: 40, MAX_RETRIES_PER_TASK: 3 }, undefined, [adapter]);
    try {
      const project = (await planApp.inject({ method: "POST", url: "/api/projects", payload: { name: "invalid-plan-test", rootPath: directory } })).json().project;
      const response = await planApp.inject({ method: "POST", url: `/api/projects/${project.id}/plan`, payload: { description: "Plan a dependency cycle", providerId: "ollama", modelId: "test-model" } });
      expect(response.statusCode).toBe(502);
      expect(response.body).toContain("invalid task plan");
      expect((await planApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks).toHaveLength(0);
    } finally { await planApp.close(); }
  });

  it("reports read-only Git status for a registered workspace", async (context) => {
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: directory, encoding: "utf8" });
    if (initialized.error) context.skip(`Git process is unavailable in this environment: ${initialized.error.message}`);
    expect(initialized.status).toBe(0);
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "git-status-test", rootPath: directory } })).json().project;
    const response = await app.inject(`/api/projects/${project.id}/git/status`);
    expect(response.statusCode).toBe(200);
    expect(response.json().git.branch).toMatch(/(?:main|master)/);
    expect(response.json().git.changes.some((change: { path: string }) => change.path === "generated.txt")).toBe(true);
    writeFileSync(join(directory, "git-tracked.txt"), "initial\n");
    const staged = spawnSync("git", ["add", "git-tracked.txt"], { cwd: directory, encoding: "utf8" });
    if (staged.error) context.skip(`Git staging is unavailable in this environment: ${staged.error.message}`);
    expect(staged.status).toBe(0);
    writeFileSync(join(directory, "git-tracked.txt"), "updated\nsecond line\n");
    const diffSummary = await app.inject(`/api/projects/${project.id}/git/diff-summary`);
    expect(diffSummary.statusCode).toBe(200);
    expect(diffSummary.json().diff.files).toContainEqual({ path: "git-tracked.txt", added: 2, deleted: 1, staged: false });
  });

  it("includes persisted conversation history in follow-up model requests", async () => {
    const adapter = new RecordingModelAdapter();
    const conversationApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "history.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 3, MAX_TOOL_STEPS_PER_TASK: 40 }, undefined, [adapter]);
    try {
      const project = (await conversationApp.inject({ method: "POST", url: "/api/projects", payload: { name: "history-test", rootPath: directory } })).json().project;
      const conversation = (await conversationApp.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
      await conversationApp.inject({ method: "POST", url: `/api/projects/${project.id}/memory`, payload: { kind: "fact", content: "The service uses SQLite for local persistence." } });
      await conversationApp.inject({ method: "POST", url: `/api/projects/${project.id}/memory`, payload: { kind: "decision", content: "Dashboard accent color is green." } });
      const firstTask = (await conversationApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Document SQLite persistence" } })).json().task;
      await conversationApp.inject({ method: "POST", url: `/api/tasks/${firstTask.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      const secondTask = (await conversationApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Follow up on SQLite persistence" } })).json().task;
      await conversationApp.inject({ method: "POST", url: `/api/tasks/${secondTask.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(adapter.requests[1]?.messages[0]?.content).toContain("The service uses SQLite for local persistence");
      expect(adapter.requests[1]?.messages[0]?.content).not.toContain("Dashboard accent color");
      expect(adapter.requests[1]?.messages.slice(1)).toEqual([
        { role: "user", content: "Document SQLite persistence" },
        { role: "assistant", content: "Response to Document SQLite persistence" },
        { role: "user", content: "Follow up on SQLite persistence" }
      ]);
    } finally {
      await conversationApp.close();
    }
  });

  it("aborts an active provider request and keeps the task cancelled", async () => {
    const adapter = new AbortableTestAdapter();
    const cancellableApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "cancel.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 3, MAX_TOOL_STEPS_PER_TASK: 40 }, undefined, [adapter]);
    try {
      const project = (await cancellableApp.inject({ method: "POST", url: "/api/projects", payload: { name: "cancel-test", rootPath: directory } })).json().project;
      const conversation = (await cancellableApp.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
      const task = (await cancellableApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Wait for cancellation", role: "backend" } })).json().task;
      expect(task.role).toBe("backend");
      const dependent = (await cancellableApp.inject({ method: "POST", url: `/api/projects/${project.id}/tasks`, payload: { title: "Wait on backend", description: "Blocked if backend cancels", dependencies: [task.id] } })).json().task;
      expect(dependent.status).toBe("pending");
      const descendant = (await cancellableApp.inject({ method: "POST", url: `/api/projects/${project.id}/tasks`, payload: { title: "Wait on dependent", description: "Blocked through dependency chain", dependencies: [dependent.id] } })).json().task;
      expect(descendant.status).toBe("pending");
      const run = cancellableApp.inject({ method: "POST", url: `/api/tasks/${task.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      await adapter.started;
      const conflictingRun = await cancellableApp.inject({ method: "POST", url: `/api/tasks/${task.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      expect(conflictingRun.statusCode).toBe(409);
      expect(conflictingRun.json().error).toContain("Cannot run a running task");
      expect(adapter.requests[0]?.system).toContain("ROLE: BACKEND ENGINEER");
      const cancellation = await cancellableApp.inject({ method: "POST", url: `/api/tasks/${task.id}/cancel` });
      expect(cancellation.statusCode).toBe(200);
      expect((await run).json()).toMatchObject({ cancelled: true, taskId: task.id });
      const persistedTask = (await cancellableApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((value: { id: string }) => value.id === task.id);
      expect(persistedTask.status).toBe("cancelled");
      const blockedDependent = (await cancellableApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((value: { id: string }) => value.id === dependent.id);
      expect(blockedDependent.status).toBe("blocked");
      const blockedDescendant = (await cancellableApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((value: { id: string }) => value.id === descendant.id);
      expect(blockedDescendant.status).toBe("blocked");
      const lateDependent = (await cancellableApp.inject({ method: "POST", url: `/api/projects/${project.id}/tasks`, payload: { title: "Late dependent", description: "Prerequisite already cancelled", dependencies: [task.id] } })).json().task;
      expect(lateDependent.status).toBe("blocked");
    } finally {
      await cancellableApp.close();
    }
  });

  it("enforces the configured concurrent task limit and frees capacity on cancellation", async () => {
    const adapter = new AbortableTestAdapter();
    const limitedApp = await createApp({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 0, FRONTEND_ORIGIN: "http://localhost:5173", DATABASE_URL: `file:${join(directory, "limit.db")}`, PR0_WORKSPACE_ROOT: directory, DEFAULT_AGENT_MODE: "supervised", DEFAULT_TASK_TIMEOUT_MS: 10_000, MAX_CONCURRENT_TASKS: 1, MAX_TOOL_STEPS_PER_TASK: 40 }, undefined, [adapter]);
    try {
      const project = (await limitedApp.inject({ method: "POST", url: "/api/projects", payload: { name: "limit-test", rootPath: directory } })).json().project;
      const conversation = (await limitedApp.inject({ method: "POST", url: "/api/conversations", payload: { projectId: project.id } })).json().conversation;
      const firstTask = (await limitedApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Hold one task" } })).json().task;
      const secondTask = (await limitedApp.inject({ method: "POST", url: `/api/conversations/${conversation.id}/messages`, payload: { content: "Wait for a slot" } })).json().task;
      const firstRun = limitedApp.inject({ method: "POST", url: `/api/tasks/${firstTask.id}/run`, payload: { providerId: "ollama", modelId: "test-model" } });
      await adapter.started;
      const rejectedRun = await limitedApp.inject({ method: "POST", url: `/api/tasks/${secondTask.id}/run`, payload: { providerId: "mock" } });
      expect(rejectedRun.statusCode).toBe(429);
      expect(rejectedRun.headers["retry-after"]).toBe("1");
      expect((await limitedApp.inject(`/api/projects/${project.id}/tasks`)).json().tasks.find((task: { id: string }) => task.id === secondTask.id).status).toBe("ready");
      expect((await limitedApp.inject({ method: "POST", url: `/api/tasks/${firstTask.id}/cancel` })).statusCode).toBe(200);
      await firstRun;
      const retriedRun = await limitedApp.inject({ method: "POST", url: `/api/tasks/${secondTask.id}/run`, payload: { providerId: "mock" } });
      expect(retriedRun.statusCode).toBe(200);
    } finally {
      await limitedApp.close();
    }
  });
});
