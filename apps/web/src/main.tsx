import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";
import "./workspace.css";

type Project = { id: string; name: string; rootPath: string };
type Task = { id: string; title: string; status: string; role: string; description: string; dependencies?: string[]; retryAttempts?: number; execution?: { provider: string; model: string; retryAttempts: number; result: { summary: string; status: string } } | null };
type TaskPlan = { id: string; projectId: string; summary: string; tasks: Task[] };
type PublicResearchResult = { url: string; title: string; text: string };
type BrowserAutomationResult = { url: string; title: string; text: string; links: string[]; screenshotBase64: string; actions: Array<{ type: string; selector: string; ok: boolean; message: string }> };
type Provider = { id: string; configured: boolean; defaultModel: string | null };
type Conversation = { id: string; projectId: string; createdAt: string };
type ChatMessage = { id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string };
type FileEntry = { name: string; path: string; type: "file" | "directory" | "symlink" | "other" };
type SearchMatch = { path: string; line: number; text: string };
type Approval = { id: string; taskId: string; action: string; risk: string; operationKind: string | null; createdAt: string; preview?: { path: string; content: string; contentTruncated: boolean; overwrite: boolean } };
type TerminalSession = { id: string; projectId: string; taskId: string; workingDirectory: string; executable: string; args: string[]; status: "running" | "exited" | "failed" | "stopped"; output: string; exitCode: number | null };
type GitStatus = { branch: string; changes: Array<{ status: string; path: string }> };
type GitDiffSummary = { files: Array<{ path: string; added: number | null; deleted: number | null; staged: boolean }>; truncated: boolean };
type GitPatch = { patch: string; files: string[]; truncated: boolean };
type GitCommit = { hash: string; shortHash: string; authoredAt: string; author: string; subject: string };
type GitCheckpoint = { id: string; shortHash: string; createdAt: string; subject: string };
type GitRollbackPreview = { checkpointId: string; checkpointHead: string; currentHead: string; branch: string; commits: GitCommit[]; files: string[]; truncated: boolean };
type MemoryNote = { id: string; projectId: string; kind: "fact" | "decision" | "outcome"; content: string; createdAt: string; updatedAt: string };
type UsageSummary = { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unknownCostRequests: number };
type ManualTodo = { id: string; projectId: string; title: string; description: string; priority: number; acceptanceCriteria: string[]; status: "open" | "completed"; createdAt: string; updatedAt: string };
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => { const headers = new Headers(init?.headers); if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json"); const res = await fetch(`/api${path}`, { ...init, headers }); const data = await res.json() as T & { error?: string }; if (!res.ok) throw new Error(data.error ?? "Request failed"); return data; };
function App() {
  const [projects, setProjects] = useState<Project[]>([]); const [active, setActive] = useState<Project>(); const [tasks, setTasks] = useState<Task[]>([]); const [message, setMessage] = useState(""); const [status, setStatus] = useState("Connected to local workspace"); const [result, setResult] = useState(""); const [providers, setProviders] = useState<Provider[]>([{ id: "mock", configured: true, defaultModel: "mock" }]); const [unavailableProviders, setUnavailableProviders] = useState<string[]>([]); const [providerId, setProviderId] = useState("mock"); const [modelId, setModelId] = useState("");
  const [agentRole, setAgentRole] = useState("orchestrator");
  const [runningTaskId, setRunningTaskId] = useState<string>();
  const [dependencyId, setDependencyId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [explorerPath, setExplorerPath] = useState(".");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [filePreview, setFilePreview] = useState<{ path: string; content: string }>();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [terminalTaskId, setTerminalTaskId] = useState("");
  const [terminalExecutable, setTerminalExecutable] = useState("npm");
  const [terminalArguments, setTerminalArguments] = useState("");
  const [gitStatus, setGitStatus] = useState<GitStatus>();
  const [gitDiff, setGitDiff] = useState<GitDiffSummary>();
  const [gitError, setGitError] = useState("");
  const [gitPatch, setGitPatch] = useState<{ staged: GitPatch; unstaged: GitPatch }>();
  const [gitPatchView, setGitPatchView] = useState<"unstaged" | "staged">("unstaged");
  const [gitHistory, setGitHistory] = useState<GitCommit[]>([]);
  const [gitHistoryTruncated, setGitHistoryTruncated] = useState(false);
  const [gitCheckpoints, setGitCheckpoints] = useState<GitCheckpoint[]>([]);
  const [rollbackPreview, setRollbackPreview] = useState<GitRollbackPreview | null>(null);
  const [memories, setMemories] = useState<MemoryNote[]>([]);
  const [memoryKind, setMemoryKind] = useState<MemoryNote["kind"]>("fact");
  const [memoryContent, setMemoryContent] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string>();
  const [usage, setUsage] = useState<UsageSummary>();
  const [todos, setTodos] = useState<ManualTodo[]>([]);
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDescription, setTodoDescription] = useState("");
  const [todoPriority, setTodoPriority] = useState(0);
  const [todoCriteria, setTodoCriteria] = useState("");
  const [editingTodoId, setEditingTodoId] = useState<string>();
  const [planSummary, setPlanSummary] = useState("");
  const [planning, setPlanning] = useState(false);
  const [activePlan, setActivePlan] = useState<TaskPlan | null>(null);
  const [planRunActive, setPlanRunActive] = useState(false);
  const [researchUrl, setResearchUrl] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchResult, setResearchResult] = useState<PublicResearchResult | null>(null);
  const [browserAction, setBrowserAction] = useState<"inspect" | "click" | "fill">("inspect");
  const [browserSelector, setBrowserSelector] = useState("");
  const [browserValue, setBrowserValue] = useState("");
  const [browserRunning, setBrowserRunning] = useState(false);
  const [browserResult, setBrowserResult] = useState<BrowserAutomationResult | null>(null);
  const load = async (preferredProject?: Project) => { const data = await api<{ projects: Project[] }>("/projects"); setProjects(data.projects); const project = preferredProject ?? active ?? data.projects[0]; setActive(project); if (!project) {
    setTasks([]); setResult(""); setConversations([]); setActiveConversationId(undefined); setMessages([]); setApprovals([]); setTerminalSessions([]); setMemories([]); setUsage(undefined); setTodos([]);
    return;
  }
  const [taskData, conversationData, approvalData, terminalData, memoryData, usageData, todoData] = await Promise.all([
    api<{ tasks: Task[] }>(`/projects/${project.id}/tasks`),
    api<{ conversations: Conversation[] }>(`/projects/${project.id}/conversations`),
    api<{ approvals: Approval[] }>(`/projects/${project.id}/approvals`),
    api<{ sessions: TerminalSession[] }>(`/projects/${project.id}/terminal-sessions`),
    api<{ memories: MemoryNote[] }>(`/projects/${project.id}/memory`),
    api<{ usage: UsageSummary }>(`/projects/${project.id}/usage`),
    api<{ todos: ManualTodo[] }>(`/projects/${project.id}/todos`)
  ]);
  setTasks(taskData.tasks);
  setApprovals(approvalData.approvals);
  setResult(taskData.tasks.find((task) => task.execution)?.execution?.result.summary ?? "");
  setConversations(conversationData.conversations);
  const conversation = conversationData.conversations.find((item) => item.id === activeConversationId) ?? conversationData.conversations[0];
  setActiveConversationId(conversation?.id);
  if (conversation) {
    const messageData = await api<{ messages: ChatMessage[] }>(`/conversations/${conversation.id}/messages`);
    setMessages(messageData.messages);
  } else setMessages([]);
  setTerminalSessions(terminalData.sessions);
  setMemories(memoryData.memories);
  setUsage(usageData.usage);
  setTodos(todoData.todos);
  };
  useEffect(() => { void load().catch((error: Error) => setStatus(error.message)); void api<{ providers: Provider[]; unavailable: string[] }>("/providers").then((data) => { setProviders(data.providers); setUnavailableProviders(data.unavailable); }).catch((error: Error) => setStatus(error.message)); }, []);
  const createProject = async () => { const rootPath = window.prompt("Workspace directory", "."); const name = window.prompt("Project name", "My workspace"); if (!rootPath || !name) return; try { const { project } = await api<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify({ name, rootPath }) }); await load(project); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not create project"); } };
  const send = async () => {
    if (!active || !message.trim()) return;
    setStatus("Creating execution task…");
    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const created = await api<{ conversation: Conversation }>("/conversations", { method: "POST", body: JSON.stringify({ projectId: active.id }) });
        conversationId = created.conversation.id;
        setConversations((current) => [created.conversation, ...current]);
        setActiveConversationId(conversationId);
      }
      const response = await api<{ message: ChatMessage; task: Task }>(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ content: message, mode: "supervised", role: agentRole, dependencies: dependencyId ? [dependencyId] : [] }) });
      setMessage(""); setDependencyId("");
      setTasks((current) => [response.task, ...current]);
      setMessages((current) => [...current, response.message]);
      setStatus("Task ready — run it when you are ready.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not create task"); }
  };
  const chooseProvider = (id: string) => { setProviderId(id); setModelId(providers.find((provider) => provider.id === id)?.defaultModel ?? ""); };
  const run = async (task: Task) => {
    setRunningTaskId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "running" } : item));
    setStatus(`${providerId} model is executing…`);
    try {
      const data = await api<{ result?: { summary: string }; provider?: string; model?: string; cancelled?: boolean }>(`/tasks/${task.id}/run`, { method: "POST", body: JSON.stringify({ providerId, ...(modelId.trim() ? { modelId: modelId.trim() } : {}) }) });
      if (data.cancelled) {
        setStatus("Task cancelled.");
        await load();
        return;
      }
      if (!data.result || !data.provider || !data.model) throw new Error("The server returned an incomplete task result");
      setResult(data.result.summary);
      setStatus(`Task completed with ${data.provider} / ${data.model}.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Execution failed");
      await load();
    } finally {
      setRunningTaskId((current) => current === task.id ? undefined : current);
    }
  };
  const cancel = async (task: Task) => {
    setStatus("Cancelling task…");
    try {
      await api<{ ok: boolean }>(`/tasks/${task.id}/cancel`, { method: "POST" });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "cancelled" } : item));
      setStatus("Task cancelled.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not cancel task");
    }
  };
  useEffect(() => {
    if (!active || !runningTaskId) return;
    const refreshTaskApprovals = async () => {
      try {
        const [approvalData, taskData] = await Promise.all([
          api<{ approvals: Approval[] }>(`/projects/${active.id}/approvals`),
          api<{ tasks: Task[] }>(`/projects/${active.id}/tasks`)
        ]);
        setApprovals(approvalData.approvals);
        setTasks(taskData.tasks);
      } catch (error) { setStatus(error instanceof Error ? error.message : "Could not refresh task approvals"); }
    };
    void refreshTaskApprovals();
    const timer = setInterval(() => { void refreshTaskApprovals(); }, 500);
    return () => clearInterval(timer);
  }, [active?.id, runningTaskId]);
  const openConversation = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    try {
      const data = await api<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages`);
      setMessages(data.messages);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load conversation");
    }
  };
  const loadWorkspaceDirectory = async (path: string) => {
    if (!active) return;
    const data = await api<{ listing: { entries: FileEntry[] } }>("/files/list", { method: "POST", body: JSON.stringify({ projectId: active.id, path }) });
    setExplorerPath(path); setFileEntries(data.listing.entries); setSearchMatches([]);
  };
  const searchWorkspace = async () => {
    if (!active || !fileSearch.trim()) return;
    try {
      const data = await api<{ search: { results: SearchMatch[] } }>("/files/search", { method: "POST", body: JSON.stringify({ projectId: active.id, query: fileSearch, path: explorerPath, maxResults: 50 }) });
      setSearchMatches(data.search.results);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Search failed"); }
  };
  const researchPublicPage = async () => {
    if (!researchUrl.trim()) return;
    setResearching(true);
    try {
      const { page } = await api<{ page: { url: string; contentType: string; body: string } }>("/web/research", { method: "POST", body: JSON.stringify({ url: researchUrl.trim() }) });
      let title = page.url;
      let text = page.body;
      if (page.contentType === "text/html") {
        const document = new DOMParser().parseFromString(page.body, "text/html");
        document.querySelectorAll("script,style,noscript,svg,iframe,object,embed,form,nav,footer").forEach((element) => element.remove());
        title = document.title.trim() || page.url;
        text = document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
      }
      setResearchResult({ url: page.url, title, text: text.slice(0, 30_000) || "No readable text was found on the page." });
      setResearchUrl(page.url);
      setStatus("Public page retrieved. Treat its contents as untrusted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not research this public URL");
    } finally { setResearching(false); }
  };
  const automateBrowser = async () => {
    if (!researchUrl.trim()) return;
    setBrowserRunning(true);
    try {
      const actions = browserAction === "inspect" ? [] : browserAction === "click"
        ? [{ type: "click" as const, selector: browserSelector.trim() }]
        : [{ type: "fill" as const, selector: browserSelector.trim(), value: browserValue }];
      const { result } = await api<{ result: BrowserAutomationResult }>("/browser/automate", { method: "POST", body: JSON.stringify({ url: researchUrl.trim(), actions }) });
      setBrowserResult(result);
      setStatus("Isolated browser inspection completed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Browser automation failed");
    } finally { setBrowserRunning(false); }
  };
  const openWorkspaceFile = async (path: string) => {
    if (!active) return;
    try {
      const data = await api<{ file: { path: string; content: string } }>("/files/read", { method: "POST", body: JSON.stringify({ projectId: active.id, path }) });
      setFilePreview(data.file);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not open file"); }
  };
  useEffect(() => { if (active) void loadWorkspaceDirectory(explorerPath).catch((error: Error) => setStatus(error.message)); }, [active?.id]);
  useEffect(() => {
    if (activePlan && activePlan.projectId !== active?.id) {
      setActivePlan(null);
      setPlanRunActive(false);
    }
  }, [active?.id, activePlan?.projectId]);
  const decideApproval = async (approval: Approval, approved: boolean) => {
    try {
      await api<{ ok: boolean }>(`/approvals/${approval.id}/decision`, { method: "POST", body: JSON.stringify({ approved }) });
      setStatus(approved ? "Approval granted." : "Operation rejected.");
      if (active) await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not record approval decision"); }
  };
  const startTerminal = async () => {
    if (!active || !terminalTaskId) { setStatus("Choose a task before starting a terminal session."); return; }
    const args = terminalArguments.split("\n").map((argument) => argument.trim()).filter(Boolean);
    try {
      const response = await api<{ session?: TerminalSession; approval?: Approval }>("/terminal-sessions", { method: "POST", body: JSON.stringify({ projectId: active.id, taskId: terminalTaskId, executable: terminalExecutable, args, workingDirectory: ".", mode: "supervised" }) });
      setStatus(response.approval ? "Terminal command queued for approval." : "Terminal session started.");
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not start terminal session"); }
  };
  const stopTerminal = async (session: TerminalSession) => {
    try { await api<{ ok: boolean }>(`/terminal-sessions/${session.id}/stop`, { method: "POST" }); setStatus("Terminal session stopped."); await load(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not stop terminal session"); }
  };
  const hasRunningTerminal = terminalSessions.some((session) => session.status === "running");
  useEffect(() => {
    if (!active || !hasRunningTerminal) return;
    const timer = setInterval(() => { void api<{ sessions: TerminalSession[] }>(`/projects/${active.id}/terminal-sessions`).then((data) => setTerminalSessions(data.sessions)).catch((error: Error) => setStatus(error.message)); }, 1000);
    return () => clearInterval(timer);
  }, [active?.id, hasRunningTerminal]);
  const refreshGitStatus = async () => {
    if (!active) return;
    try {
      const [statusData, diffData, patchData, historyData, checkpointData] = await Promise.all([
        api<{ git: GitStatus }>(`/projects/${active.id}/git/status`),
        api<{ diff: GitDiffSummary }>(`/projects/${active.id}/git/diff-summary`),
        api<{ staged: GitPatch; unstaged: GitPatch }>(`/projects/${active.id}/git/patch`),
        api<{ history: { commits: GitCommit[]; truncated: boolean } }>(`/projects/${active.id}/git/history`),
        api<{ checkpoints: { checkpoints: GitCheckpoint[] } }>(`/projects/${active.id}/git/checkpoints`)
      ]);
      setGitStatus(statusData.git); setGitDiff(diffData.diff); setGitPatch(patchData); setGitHistory(historyData.history.commits); setGitHistoryTruncated(historyData.history.truncated); setGitCheckpoints(checkpointData.checkpoints.checkpoints); setGitError("");
    } catch (error) { setGitStatus(undefined); setGitError(error instanceof Error ? error.message : "Could not inspect Git status"); }
  };
  const createGitCheckpoint = async () => {
    if (!active) return;
    try {
      const { checkpoint } = await api<{ checkpoint: { id: string } }>(`/projects/${active.id}/git/checkpoints`, { method: "POST" });
      setStatus(`Checkpoint created: ${checkpoint.id}`);
      await refreshGitStatus();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not create a clean Git checkpoint"); }
  };
  const previewGitRollback = async (checkpoint: GitCheckpoint) => {
    if (!active) return;
    try {
      const data = await api<{ preview: GitRollbackPreview }>(`/projects/${active.id}/git/checkpoints/${checkpoint.id}/rollback-preview`);
      setRollbackPreview(data.preview);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not preview checkpoint rollback"); }
  };
  const rollbackGitCheckpoint = async () => {
    if (!active || !rollbackPreview) return;
    const confirmed = window.confirm(`Reset ${rollbackPreview.branch} to checkpoint ${rollbackPreview.checkpointId}? This rewrites the branch tip. A backup tag will preserve the current HEAD.`);
    if (!confirmed) return;
    try {
      const { rollback } = await api<{ rollback: { backupRef: string } }>(`/projects/${active.id}/git/checkpoints/${rollbackPreview.checkpointId}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true, expectedHead: rollbackPreview.currentHead }) });
      setRollbackPreview(null);
      setStatus(`Rollback complete. Previous HEAD is preserved at ${rollback.backupRef}.`);
      await refreshGitStatus();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not roll back checkpoint"); }
  };
  useEffect(() => { void refreshGitStatus().catch((error: Error) => setStatus(error.message)); }, [active?.id]);
  const saveMemory = async () => {
    if (!active || !memoryContent.trim()) return;
    try {
      const editing = memories.find((memory) => memory.id === editingMemoryId);
      if (editing) {
        await api(`/projects/${active.id}/memory/${editing.id}`, { method: "PUT", body: JSON.stringify({ kind: memoryKind, content: memoryContent }) });
        setEditingMemoryId(undefined);
      } else {
        await api(`/projects/${active.id}/memory`, { method: "POST", body: JSON.stringify({ kind: memoryKind, content: memoryContent }) });
      }
      setMemoryContent("");
      setMemories((await api<{ memories: MemoryNote[] }>(`/projects/${active.id}/memory`)).memories);
      setStatus("Project memory saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save project memory"); }
  };
  const editMemory = (memory: MemoryNote) => { setEditingMemoryId(memory.id); setMemoryKind(memory.kind); setMemoryContent(memory.content); };
  const deleteMemory = async (memory: MemoryNote) => {
    if (!active) return;
    try { await api(`/projects/${active.id}/memory/${memory.id}`, { method: "DELETE" }); setMemories((current) => current.filter((item) => item.id !== memory.id)); setStatus("Project memory deleted."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not delete project memory"); }
  };
  const saveTodo = async () => {
    if (!active || !todoTitle.trim()) return;
    const existing = todos.find((todo) => todo.id === editingTodoId);
    const payload = { title: todoTitle, description: todoDescription, priority: todoPriority, acceptanceCriteria: todoCriteria.split("\n").map((criterion) => criterion.trim()).filter(Boolean), status: existing?.status ?? "open" };
    try {
      if (existing) await api(`/projects/${active.id}/todos/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api(`/projects/${active.id}/todos`, { method: "POST", body: JSON.stringify(payload) });
      setTodoTitle(""); setTodoDescription(""); setTodoPriority(0); setTodoCriteria(""); setEditingTodoId(undefined);
      setTodos((await api<{ todos: ManualTodo[] }>(`/projects/${active.id}/todos`)).todos);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save TODO"); }
  };
  const editTodo = (todo: ManualTodo) => { setEditingTodoId(todo.id); setTodoTitle(todo.title); setTodoDescription(todo.description); setTodoPriority(todo.priority); setTodoCriteria(todo.acceptanceCriteria.join("\n")); };
  const updateTodoStatus = async (todo: ManualTodo) => {
    if (!active) return;
    try {
      await api(`/projects/${active.id}/todos/${todo.id}`, { method: "PUT", body: JSON.stringify({ title: todo.title, description: todo.description, priority: todo.priority, acceptanceCriteria: todo.acceptanceCriteria, status: todo.status === "open" ? "completed" : "open" }) });
      setTodos((await api<{ todos: ManualTodo[] }>(`/projects/${active.id}/todos`)).todos);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update TODO"); }
  };
  const deleteTodo = async (todo: ManualTodo) => {
    if (!active) return;
    try { await api(`/projects/${active.id}/todos/${todo.id}`, { method: "DELETE" }); setTodos((current) => current.filter((item) => item.id !== todo.id)); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not delete TODO"); }
  };
  const generatePlan = async () => {
    if (!active || !message.trim()) return;
    setPlanning(true); setStatus("Generating a task plan…");
    try {
      const data = await api<{ plan: TaskPlan }>(`/projects/${active.id}/plan`, { method: "POST", body: JSON.stringify({ description: message.trim(), providerId, ...(modelId.trim() ? { modelId: modelId.trim() } : {}) }) });
      setPlanSummary(data.plan.summary);
      setActivePlan(data.plan);
      setPlanRunActive(false);
      setTasks((current) => [...data.plan.tasks, ...current]);
      setMessage("");
      setStatus(`Plan created with ${data.plan.tasks.length} tasks. Review the dependency queue before running them.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not generate task plan"); }
    finally { setPlanning(false); }
  };
  const runPlan = async () => {
    if (!activePlan) return;
    setStatus("Starting task plan…");
    try {
      await api<{ planId: string; status: "running"; taskIds: string[] }>(`/task-plans/${activePlan.id}/run`, { method: "POST", body: JSON.stringify({ providerId, ...(modelId.trim() ? { modelId: modelId.trim() } : {}) }) });
      setPlanRunActive(true);
      setStatus("Plan is running. Progress updates automatically.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not run task plan"); }
  };
  useEffect(() => {
    if (!activePlan || !planRunActive) return;
    const stream = new EventSource(`/api/task-plans/${activePlan.id}/events`);
    stream.onmessage = (event) => {
      let data: { plan: TaskPlan };
      try {
        data = JSON.parse(event.data) as { plan: TaskPlan };
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not parse plan progress");
        return;
      }
      setActivePlan((current) => current?.id === data.plan.id ? data.plan : current);
      setTasks((current) => current.map((task) => data.plan.tasks.find((plannedTask) => plannedTask.id === task.id) ?? task));
      const completed = data.plan.tasks.filter((task) => task.status === "completed").length;
      const terminal = data.plan.tasks.every((task) => ["completed", "failed", "blocked", "cancelled"].includes(task.status));
      if (terminal) {
        setPlanRunActive(false);
        setStatus(`Plan finished: ${completed}/${data.plan.tasks.length} tasks completed.`);
        stream.close();
      }
    };
    stream.onerror = () => setStatus("Plan progress connection interrupted; reconnecting…");
    return () => stream.close();
  }, [activePlan?.id, planRunActive]);
  const visiblePlan = activePlan?.projectId === active?.id ? activePlan : null;
  const completedPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const runningPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "running").length ?? 0;
  const waitingPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "pending" || task.status === "ready").length ?? 0;
  const failedPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "failed").length ?? 0;
  const blockedPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "blocked").length ?? 0;
  const cancelledPlanTasks = visiblePlan?.tasks.filter((task) => task.status === "cancelled").length ?? 0;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const dependentsByTaskId = new Map<string, string[]>();
  for (const task of tasks) for (const dependencyId of task.dependencies ?? []) {
    const dependents = dependentsByTaskId.get(dependencyId) ?? [];
    dependents.push(task.title);
    dependentsByTaskId.set(dependencyId, dependents);
  }
  return (
    <div className="shell">
      <aside>
        <div className="brand"><span>PR</span><div>Project PR-0<small>local agent workspace</small></div></div>
        <button className="project-button" onClick={() => void createProject()}>+ New project</button>
        <section><p>PROJECTS</p>{projects.map((project) => <button className={active?.id === project.id ? "nav selected" : "nav"} key={project.id} onClick={() => void load(project)}>{project.name}</button>)}</section>
        <section><p>CONVERSATIONS</p>{conversations.map((conversation, index) => <button className={activeConversationId === conversation.id ? "nav selected" : "nav"} key={conversation.id} onClick={() => void openConversation(conversation.id)}>Conversation {conversations.length - index}</button>)}</section>
        <section>
          <p>FILES</p>
          <div className="file-tools">
            <button disabled={explorerPath === "."} onClick={() => { const parent = explorerPath.split("/").slice(0, -1).join("/") || "."; void loadWorkspaceDirectory(parent); }}>Up</button>
            <small>{explorerPath}</small>
            <input aria-label="Search workspace files" value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchWorkspace(); }} placeholder="Search files" />
            <button disabled={!fileSearch.trim()} onClick={() => void searchWorkspace()}>Search</button>
          </div>
          {searchMatches.length ? searchMatches.map((match) => <button className="nav" key={`${match.path}:${match.line}`} onClick={() => void openWorkspaceFile(match.path)}>{match.path}:{match.line}</button>) : fileEntries.map((entry) => <button className="nav" key={entry.path} disabled={entry.type === "symlink"} onClick={() => entry.type === "directory" ? void loadWorkspaceDirectory(entry.path) : entry.type === "file" ? void openWorkspaceFile(entry.path) : undefined}>{entry.type === "directory" ? "▸ " : entry.type === "file" ? "· " : ""}{entry.name}</button>)}
        </section>
        <section><p>APPROVALS</p>{approvals.length ? approvals.map((approval) => <div className="approval-item" key={approval.id}><b>{approval.action}</b><small>{approval.operationKind ?? "operation"} · {approval.risk}</small>{approval.preview && <><small>Target: {approval.preview.path}{approval.preview.overwrite ? " · overwrite" : " · create only"}</small><details className="approval-preview"><summary>Review proposed contents{approval.preview.contentTruncated ? " (preview truncated)" : ""}</summary><pre>{approval.preview.content}</pre></details></>}<div className="approval-actions"><button onClick={() => void decideApproval(approval, true)}>Approve</button><button onClick={() => void decideApproval(approval, false)}>Reject</button></div></div>) : <div className="empty compact">No pending approvals.</div>}</section>
        <section>
          <p>GIT</p>
          <div className="git-actions"><button className="nav" disabled={!active} onClick={() => void refreshGitStatus()}>Refresh status</button><button className="nav" disabled={!active} onClick={() => void createGitCheckpoint()}>Create checkpoint</button></div>
          {gitError && <small>{gitError}</small>}
          {gitStatus && <><small>{gitStatus.branch}</small>{gitStatus.changes.map((change) => <div className="task" key={change.path}><small>{change.status}</small><span>{change.path}</span></div>)}</>}{gitDiff?.files.map((file) => <div className="task" key={`${file.path}:${file.staged}`}><small>{file.staged ? "staged" : "working"} · +{file.added ?? "binary"} -{file.deleted ?? "binary"}</small><span>{file.path}</span></div>)}
          {gitPatch && <details className="git-view"><summary>Patch viewer</summary><div className="git-actions"><button aria-pressed={gitPatchView === "unstaged"} onClick={() => setGitPatchView("unstaged")}>Working tree</button><button aria-pressed={gitPatchView === "staged"} onClick={() => setGitPatchView("staged")}>Staged</button></div><small>{gitPatch[gitPatchView].files.length} files{gitPatch[gitPatchView].truncated ? " · truncated" : ""}</small><pre className="git-patch">{gitPatch[gitPatchView].patch || "No patch available."}</pre></details>}
          <details className="git-view"><summary>Commit history {gitHistoryTruncated ? "(latest 25)" : `(${gitHistory.length})`}</summary>{gitHistory.map((commit) => <div className="git-commit" key={commit.hash}><b>{commit.shortHash} · {commit.subject}</b><small>{commit.author} · {commit.authoredAt}</small></div>)}</details>
          {gitCheckpoints.map((checkpoint) => <div className="git-checkpoint" key={checkpoint.id}><b>{checkpoint.shortHash}</b><small>{checkpoint.subject} · {checkpoint.createdAt}</small><button onClick={() => void previewGitRollback(checkpoint)}>Preview rollback</button></div>)}
          {rollbackPreview && <div className="rollback-preview"><b>Rollback preview</b><small>Branch {rollbackPreview.branch} · {rollbackPreview.commits.length} commits · {rollbackPreview.files.length} changed files{rollbackPreview.truncated ? " · preview truncated" : ""}</small>{rollbackPreview.commits.slice(0, 5).map((commit) => <small key={commit.hash}>{commit.shortHash} · {commit.subject}</small>)}{rollbackPreview.files.slice(0, 10).map((path) => <small key={path}>{path}</small>)}<div className="git-actions"><button onClick={() => setRollbackPreview(null)}>Cancel</button><button disabled={!rollbackPreview.commits.length} onClick={() => void rollbackGitCheckpoint()}>Rollback…</button></div></div>}
        </section>
        {usage && <section><p>MODEL USAGE</p><small>{usage.requests} requests · {usage.inputTokens} input / {usage.outputTokens} output tokens</small><small>Estimated cost: ${usage.estimatedCostUsd.toFixed(4)} USD</small>{usage.unknownCostRequests > 0 && <small>{usage.unknownCostRequests} requests with unknown cost</small>}</section>}
        <section>
          <p>PROJECT MEMORY</p>
          <select aria-label="Memory type" value={memoryKind} onChange={(event) => setMemoryKind(event.target.value as MemoryNote["kind"])}><option value="fact">Fact</option><option value="decision">Decision</option><option value="outcome">Outcome</option></select>
          <textarea aria-label="Project memory content" value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder="Record a verified project note" />
          <button className="nav" disabled={!memoryContent.trim()} onClick={() => void saveMemory()}>{editingMemoryId ? "Save note" : "Add note"}</button>
          {editingMemoryId && <button className="nav" onClick={() => { setEditingMemoryId(undefined); setMemoryContent(""); }}>Cancel edit</button>}
          {memories.map((memory) => <div className="memory-item" key={memory.id}><small>{memory.kind}</small><p>{memory.content}</p><div className="approval-actions"><button onClick={() => editMemory(memory)}>Edit</button><button onClick={() => void deleteMemory(memory)}>Delete</button></div></div>)}
        </section>
        <section>
          <p>TODO</p>
          <div className="todo-tools">
            <input aria-label="TODO title" value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="TODO title" />
            <input aria-label="TODO description" value={todoDescription} onChange={(event) => setTodoDescription(event.target.value)} placeholder="TODO description" />
            <input aria-label="TODO priority" type="number" min="0" max="100" value={todoPriority} onChange={(event) => setTodoPriority(Number(event.target.value))} />
            <textarea aria-label="TODO criteria" value={todoCriteria} onChange={(event) => setTodoCriteria(event.target.value)} placeholder="TODO criteria" />
            <button disabled={!todoTitle.trim()} onClick={() => void saveTodo()}>{editingTodoId ? "Save TODO" : "Add TODO"}</button>
            {editingTodoId && <button className="nav" onClick={() => { setEditingTodoId(undefined); setTodoTitle(""); setTodoDescription(""); setTodoPriority(0); setTodoCriteria(""); }}>Cancel edit</button>}
          </div>
          {todos.map((todo) => <div className="todo-item" key={todo.id}><div><b>{todo.title}</b><small>{todo.description} · priority {todo.priority} · {todo.status}</small>{todo.acceptanceCriteria.map((criterion) => <small key={criterion}>- {criterion}</small>)}</div><div className="approval-actions"><button onClick={() => editTodo(todo)}>Edit</button><button onClick={() => void updateTodoStatus(todo)}>{todo.status === "open" ? "Complete" : "Reopen"}</button><button onClick={() => void deleteTodo(todo)}>Delete</button></div></div>)}
        </section>
        <div className="connection">● {status}</div>
      </aside>
      <main>
        <header><div><p className="eyebrow">ACTIVE PROJECT</p><h1>{active?.name ?? "No project selected"}</h1></div><div className="badge">Supervised mode</div></header>
        <div className="grid">
          <section className="chat card">
            <div className="card-head"><h2>Orchestrator</h2><span>{providerId} / {modelId || "select model"}</span></div>
            <div className="conversation">
              {filePreview && <article className="assistant"><b>{filePreview.path}</b><pre>{filePreview.content}</pre></article>}
              {researchResult && <article className="assistant web-research-result"><b>{researchResult.title}</b><a href={researchResult.url} target="_blank" rel="noreferrer">{researchResult.url}</a><p>{researchResult.text}</p></article>}
              {browserResult && <article className="assistant browser-result"><b>{browserResult.title || browserResult.url}</b><a href={browserResult.url} target="_blank" rel="noreferrer">{browserResult.url}</a><img src={`data:image/png;base64,${browserResult.screenshotBase64}`} alt={`Isolated browser screenshot of ${browserResult.title || browserResult.url}`} /><p>{browserResult.text}</p>{browserResult.actions.map((action, index) => <small key={`${action.type}:${action.selector}:${index}`}>{action.ok ? "Completed" : "Blocked"} · {action.type} {action.selector} · {action.message}</small>)}{browserResult.links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>)}</article>}
              {messages.length ? messages.map((item) => <article className="assistant" key={item.id}><b>{item.role === "user" ? "You" : "Agent"}</b><p>{item.content}</p></article>) : result ? <article className="assistant"><b>Execution report</b><p>{result}</p></article> : <div className="empty">Describe a development task to create a persisted, runnable task.</div>}
            </div>
            <div className="composer">
              <div className="provider-controls">
                <select aria-label="Task prerequisite" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">No prerequisite</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} ({task.status})</option>)}</select>
                <select aria-label="Agent role" value={agentRole} onChange={(event) => setAgentRole(event.target.value)}>{["orchestrator", "architect", "frontend", "backend", "debugger", "reviewer", "qa", "researcher", "documentation"].map((role) => <option key={role} value={role}>{role}</option>)}</select>
                <select aria-label="Model provider" value={providerId} onChange={(event) => chooseProvider(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.id === "mock" ? "Mock (no cost)" : provider.id === "ollama" ? "Ollama (local)" : `${provider.id} API`}</option>)}{unavailableProviders.map((id) => <option key={id} value={id}>{id} (configure server credentials)</option>)}</select>
                {providerId !== "mock" && <input aria-label="Model id" placeholder="Model id (or server default)" value={modelId} onChange={(event) => setModelId(event.target.value)} />}
              </div>
              <div className="web-research-controls"><input aria-label="Public HTTPS URL" type="url" placeholder="https://public-site.example/article" value={researchUrl} onChange={(event) => setResearchUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void researchPublicPage(); }} /><button disabled={!researchUrl.trim() || researching} onClick={() => void researchPublicPage()}>{researching ? "Researching…" : "Research URL"}</button></div>
              <div className="browser-controls"><select aria-label="Browser action" value={browserAction} onChange={(event) => setBrowserAction(event.target.value as typeof browserAction)}><option value="inspect">Inspect page</option><option value="click">Click link or details</option><option value="fill">Fill text field</option></select>{browserAction !== "inspect" && <input aria-label="Browser selector" placeholder="#search" value={browserSelector} onChange={(event) => setBrowserSelector(event.target.value)} />}{browserAction === "fill" && <input aria-label="Browser text value" maxLength={512} placeholder="Text to fill locally" value={browserValue} onChange={(event) => setBrowserValue(event.target.value)} />}<button disabled={!researchUrl.trim() || browserRunning || (browserAction !== "inspect" && !browserSelector.trim())} onClick={() => void automateBrowser()}>{browserRunning ? "Inspecting…" : "Run in browser"}</button></div>
              <div className="compose-row"><textarea aria-label="Development task" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="What should the team build or change?" /><button onClick={() => void generatePlan()} disabled={!active || !message.trim() || planning || planRunActive}>{planning ? "Planning…" : "Plan"}</button><button onClick={() => void send()} disabled={!active || !message.trim()}>Send ↵</button></div>
            </div>
          </section>
          <section className="activity card">
            <div className="card-head"><h2>Agent activity</h2><span className="live">● live</span></div>
            {visiblePlan && <><div className="plan-progress"><div className="plan-progress-copy"><b>{visiblePlan.summary || planSummary}</b><small>{completedPlanTasks}/{visiblePlan.tasks.length} completed · {runningPlanTasks} running · {waitingPlanTasks} waiting · {failedPlanTasks} failed · {blockedPlanTasks} blocked · {cancelledPlanTasks} cancelled</small></div><progress aria-label="Task plan completion" max={visiblePlan.tasks.length} value={completedPlanTasks} /><button disabled={planRunActive || waitingPlanTasks === 0} onClick={() => void runPlan()}>{planRunActive ? "Running…" : "Run plan"}</button></div><ol className="plan-flow" aria-label="Task dependency flow">{visiblePlan.tasks.map((task, index) => { const prerequisites = (task.dependencies ?? []).map((id) => visiblePlan.tasks.find((candidate) => candidate.id === id)?.title ?? "Unknown task"); return <li className={`plan-flow-item status-${task.status}`} key={task.id}><span className="plan-step">{index + 1}</span><div><b>{task.title}</b><small>{task.role} · {task.status}{prerequisites.length ? ` · after ${prerequisites.join(", ")}` : " · no prerequisites"}</small></div></li>; })}</ol></>}
            <div className="agent"><div className="avatar">O</div><div><b>Orchestrator</b><small>Routes plans and verifies completion</small></div><span>{runningTaskId ? "running" : "idle"}</span></div>
            <h3>Execution queue</h3>
            {tasks.length ? tasks.map((task) => { const prerequisites = (task.dependencies ?? []).map((id) => tasksById.get(id)?.title ?? "Missing task"); const dependents = dependentsByTaskId.get(task.id) ?? []; return <div className="task" key={task.id}><div><b>{task.title}</b><small>{task.role} · {task.status}{(task.retryAttempts ?? task.execution?.retryAttempts ?? 0) > 0 ? ` · ${task.retryAttempts ?? task.execution?.retryAttempts} retry attempts` : ""}</small>{prerequisites.length > 0 && <small className="task-relations">Depends on: {prerequisites.join(", ")}</small>}{dependents.length > 0 && <small className="task-relations">Unlocks: {dependents.join(", ")}</small>}</div>{task.status === "ready" && <button disabled={Boolean(runningTaskId)} onClick={() => void run(task)}>Run</button>}{runningTaskId === task.id && <button onClick={() => void cancel(task)}>Stop</button>}</div>; }) : <div className="empty compact">No execution tasks yet.</div>}
          </section>
        </div>
        <section className="bottom card">
          <div className="card-head"><h2>Terminal & verification</h2><span>Approved local processes</span></div>
          <div className="terminal-controls">
            <select aria-label="Task for terminal session" value={terminalTaskId} onChange={(event) => setTerminalTaskId(event.target.value)}><option value="">Select task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
            <select aria-label="Terminal executable" value={terminalExecutable} onChange={(event) => setTerminalExecutable(event.target.value)}>{["node", "npm", "npx", "git"].map((executable) => <option key={executable} value={executable}>{executable}</option>)}</select>
            <textarea aria-label="Terminal arguments" value={terminalArguments} onChange={(event) => setTerminalArguments(event.target.value)} placeholder="One argument per line" />
            <button disabled={!active || !terminalTaskId} onClick={() => void startTerminal()}>Request command</button>
          </div>
          {terminalSessions.map((session) => <div className="terminal-session" key={session.id}><div><b>{session.executable} {session.args.join(" ")}</b><span>{session.status}{session.exitCode === null ? "" : ` · exit ${session.exitCode}`}</span>{session.status === "running" && <button onClick={() => void stopTerminal(session)}>Stop</button>}</div><pre>{session.output || "Waiting for output…"}</pre></div>)}
        </section>
      </main>
    </div>
  );
}
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element was not found");
const root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<StrictMode><App /></StrictMode>);
