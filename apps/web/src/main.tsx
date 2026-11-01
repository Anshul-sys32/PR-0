import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Sidebar, type WorkspaceView } from "./components/Sidebar.js";
import { ApprovalInbox, TaskQueuePanel } from "./components/WorkspacePanels.js";
import { MessageText } from "./components/MessageText.js";
import "./styles.css";
import "./workspace.css";
import "./ui.css";

type Project = { id: string; name: string; rootPath: string };
type Task = { id: string; title: string; status: string; role: string; description: string; dependencies?: string[]; retryAttempts?: number; execution?: { provider: string; model: string; retryAttempts: number; result: { summary: string; status: string } } | null };
type TaskPlan = { id: string; projectId: string; summary: string; tasks: Task[] };
type PublicResearchResult = { url: string; title: string; text: string };
type BrowserAutomationResult = { url: string; title: string; text: string; links: string[]; screenshotBase64: string; actions: Array<{ type: string; selector: string; ok: boolean; message: string }> };
type ProviderStatus = "test" | "configured" | "connected" | "authentication_required" | "rate_limited" | "unsupported" | "unavailable" | "unverified";
type Provider = { id: string; configured: boolean; defaultModel: string | null; integrationType?: "api" | "local" | "test"; status?: ProviderStatus; models?: string[]; error?: string };
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
  const [activeView, setActiveView] = useState<WorkspaceView>("agent");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [approvalBusyId, setApprovalBusyId] = useState<string>();
  const [taskCreating, setTaskCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]); const [active, setActive] = useState<Project>(); const [tasks, setTasks] = useState<Task[]>([]); const [message, setMessage] = useState(""); const [status, setStatus] = useState("Connecting to local workspace…"); const [result, setResult] = useState(""); const [providers, setProviders] = useState<Provider[]>([{ id: "ollama", configured: true, integrationType: "local", status: "unverified", defaultModel: null, models: [] }, { id: "mock", configured: true, integrationType: "test", status: "test", defaultModel: "mock" }]); const [unavailableProviders, setUnavailableProviders] = useState<string[]>([]); const [providerId, setProviderId] = useState("ollama"); const [modelId, setModelId] = useState(""); const [providersLoading, setProvidersLoading] = useState(false);
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
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackExecuting, setRollbackExecuting] = useState(false);
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
  const providerCanExecute = () => {
    const selected = providers.find((provider) => provider.id === providerId);
    if (!selected || unavailableProviders.includes(providerId)) return false;
    if (providerId === "mock") return true;
    if (!modelId.trim() && !selected.defaultModel) return false;
    return selected.status === "configured" || selected.status === "connected";
  };
  const providerBlockedReason = () => {
    const selected = providers.find((provider) => provider.id === providerId);
    if (providerId === "ollama" && selected?.status === "unavailable") return selected.error ?? "Ollama is not reachable. Start Ollama and refresh provider status.";
    if (selected?.status === "authentication_required") return `${providerId} requires authentication or a server API credential.`;
    if (selected?.status === "rate_limited") return `${providerId} is rate limited. Try again later.`;
    if (selected?.status === "unsupported") return selected.error ?? `${providerId} endpoint is unsupported.`;
    if (providerId !== "mock" && !modelId.trim() && !selected?.defaultModel) return `Select an installed ${providerId} model before running tasks.`;
    return `Configure ${providerId} and refresh provider status before running tasks.`;
  };
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
  const refreshProviders = async () => {
    setProvidersLoading(true);
    try {
      const data = await api<{ providers: Provider[]; unavailable: string[] }>("/providers");
      setProviders(data.providers);
      setUnavailableProviders(data.unavailable);
      const selected = data.providers.find((provider) => provider.id === providerId);
      if (selected && !modelId.trim()) setModelId(selected.defaultModel ?? selected.models?.[0] ?? "");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not refresh provider status"); }
    finally { setProvidersLoading(false); }
  };
  useEffect(() => { void load().then(() => setStatus("Connected to local API")).catch((error: Error) => setStatus(error.message)); void refreshProviders(); }, []);
  useEffect(() => {
    if (!projectDialogOpen && !rollbackConfirmOpen) return;
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || projectCreating || rollbackExecuting) return;
      setProjectDialogOpen(false);
      setRollbackConfirmOpen(false);
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => window.removeEventListener("keydown", handleDialogKey);
  }, [projectDialogOpen, rollbackConfirmOpen, projectCreating, rollbackExecuting]);
  const createProject = async () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) {
      setProjectError("Enter a workspace name and an existing directory path.");
      return;
    }
    setProjectCreating(true);
    setProjectError("");
    try {
      const { project } = await api<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify({ name: newProjectName.trim(), rootPath: newProjectPath.trim() }) });
      setProjectDialogOpen(false);
      setNewProjectName("");
      setNewProjectPath("");
      await load(project);
      setStatus("Workspace added.");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create workspace");
    } finally { setProjectCreating(false); }
  };
  const send = async () => {
    if (!active || !message.trim() || taskCreating || unavailableProviders.includes(providerId)) return;
    setTaskCreating(true);
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
    finally { setTaskCreating(false); }
  };
  const chooseProvider = (id: string) => { const provider = providers.find((item) => item.id === id); setProviderId(id); setModelId(provider?.defaultModel ?? provider?.models?.[0] ?? ""); };
  const run = async (task: Task) => {
    if (!providerCanExecute()) { setStatus(providerBlockedReason()); return; }
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
    if (approvalBusyId) return;
    setApprovalBusyId(approval.id);
    try {
      await api<{ ok: boolean }>(`/approvals/${approval.id}/decision`, { method: "POST", body: JSON.stringify({ approved }) });
      setStatus(approved ? "Approval granted." : "Operation rejected.");
      if (active) await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not record approval decision"); }
    finally { setApprovalBusyId(undefined); }
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
    setRollbackConfirmOpen(true);
  };
  const confirmRollbackGitCheckpoint = async () => {
    if (!active || !rollbackPreview) return;
    setRollbackExecuting(true);
    try {
      const { rollback } = await api<{ rollback: { backupRef: string } }>(`/projects/${active.id}/git/checkpoints/${rollbackPreview.checkpointId}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true, expectedHead: rollbackPreview.currentHead }) });
      setRollbackConfirmOpen(false);
      setRollbackPreview(null);
      setStatus(`Rollback complete. Previous HEAD is preserved at ${rollback.backupRef}.`);
      await refreshGitStatus();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not roll back checkpoint"); }
    finally { setRollbackExecuting(false); }
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
    if (!active || !message.trim() || !providerCanExecute()) { if (!providerCanExecute()) setStatus(providerBlockedReason()); return; }
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
    if (!activePlan || !providerCanExecute()) { if (!providerCanExecute()) setStatus(providerBlockedReason()); return; }
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
  const activeProvider = providers.find((provider) => provider.id === providerId);
  const unavailableSelectedProvider = unavailableProviders.includes(providerId) || ["unavailable", "authentication_required", "rate_limited", "unsupported"].includes(activeProvider?.status ?? "");
  const providerReady = providerCanExecute();
  const providerStatusText = providerId === "mock"
    ? "Mock · explicit test mode"
    : providerId === "ollama"
      ? `Ollama · ${activeProvider?.status === "connected" ? modelId.trim() || activeProvider.defaultModel || "select a model" : activeProvider?.status?.replaceAll("_", " ") ?? "checking"}`
      : `${providerId} · ${modelId.trim() || activeProvider?.defaultModel || "model required"}`;
  const pageTitles: Record<WorkspaceView, string> = { agent: "Agent", plans: "Plans & tasks", files: "Files", terminal: "Terminal", "source-control": "Source control", todos: "TODOs", memory: "Project memory", usage: "Model usage", approvals: "Approvals" };
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const dependentsByTaskId = new Map<string, string[]>();
  for (const task of tasks) for (const dependencyId of task.dependencies ?? []) {
    const dependents = dependentsByTaskId.get(dependencyId) ?? [];
    dependents.push(task.title);
    dependentsByTaskId.set(dependencyId, dependents);
  }
  return (
    <div className={`shell${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}>
      <Sidebar projects={projects} activeProjectId={active?.id} conversations={conversations} activeConversationId={activeConversationId} pendingApprovalCount={approvals.length} view={activeView} collapsed={sidebarCollapsed} mobileOpen={mobileNavOpen} onProjectChange={(projectId) => { const project = projects.find((item) => item.id === projectId); if (project) void load(project); }} onConversationChange={(conversationId) => void openConversation(conversationId)} onNewProject={() => { setProjectError(""); setProjectDialogOpen(true); }} onNewTask={() => { setMessage(""); setActiveConversationId(undefined); setMessages([]); setResult(""); }} onNavigate={setActiveView} onToggleCollapsed={() => setSidebarCollapsed((current) => !current)} onCloseMobile={() => setMobileNavOpen(false)} />
      <main className="workspace-main">
        {rollbackConfirmOpen && rollbackPreview && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="rollback-dialog-title"><div className="dialog-heading"><div><p className="eyebrow">SOURCE CONTROL</p><h2 id="rollback-dialog-title">Confirm rollback</h2></div><button className="icon-button" aria-label="Close rollback confirmation" disabled={rollbackExecuting} onClick={() => setRollbackConfirmOpen(false)} type="button">×</button></div><p>This rewrites the <strong>{rollbackPreview.branch}</strong> branch tip to checkpoint <code>{rollbackPreview.checkpointId}</code>. Current HEAD will be preserved by a backup tag.</p><div className="rollback-confirm-details"><span>Current HEAD <code>{rollbackPreview.currentHead.slice(0, 12)}</code></span><span>Target checkpoint <code>{rollbackPreview.checkpointHead.slice(0, 12)}</code></span><span>{rollbackPreview.commits.length} commits · {rollbackPreview.files.length} changed files</span></div><div className="dialog-actions"><button className="secondary-button" disabled={rollbackExecuting} onClick={() => setRollbackConfirmOpen(false)} type="button">Keep current branch</button><button className="primary-button danger-button" disabled={rollbackExecuting} onClick={() => void confirmRollbackGitCheckpoint()} type="button">{rollbackExecuting ? "Rolling back…" : "Confirm rollback"}</button></div></section></div>}
        <header className="workspace-topbar">
          <button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} type="button"><span aria-hidden="true">Menu</span></button>
          <div className="topbar-title"><small>{active?.name ?? "No workspace selected"}</small><h1>{pageTitles[activeView]}</h1></div>
          <div className="topbar-status">
            <span className={providerId === "mock" ? "provider-badge is-mock" : unavailableSelectedProvider ? "provider-badge is-unavailable" : "provider-badge"}>
              {providerStatusText}
            </span>
            <span className="connection-state" role="status" aria-live="polite">{status}</span>
          </div>
        </header>

        {activeView === "agent" && <div className="agent-layout">
          <section className="chat-panel">
            <div className="conversation-heading"><div><p className="eyebrow">CONVERSATION</p><h2>{activeConversationId ? `Conversation ${Math.max(1, conversations.findIndex((item) => item.id === activeConversationId) + 1)}` : "Start with a task"}</h2></div><span className={`task-state ${runningTaskId ? "is-running" : ""}`}>{runningTaskId ? "Executing" : visiblePlan && planRunActive ? "Plan running" : approvals.length ? "Awaiting approval" : tasks[0]?.status ?? "Ready"}</span></div>
            <div className="conversation" aria-live="polite">
              {researchResult && <article className="result-panel web-research-result"><b>{researchResult.title}</b><a href={researchResult.url} target="_blank" rel="noreferrer">{researchResult.url}</a><p>{researchResult.text}</p></article>}
              {browserResult && <article className="result-panel browser-result"><b>{browserResult.title || browserResult.url}</b><a href={browserResult.url} target="_blank" rel="noreferrer">{browserResult.url}</a><img src={`data:image/png;base64,${browserResult.screenshotBase64}`} alt={`Isolated browser screenshot of ${browserResult.title || browserResult.url}`} /><p>{browserResult.text}</p>{browserResult.actions.map((action, index) => <small key={`${action.type}:${action.selector}:${index}`}>{action.ok ? "Completed" : "Blocked"} · {action.type} {action.selector} · {action.message}</small>)}{browserResult.links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>)}</article>}
              {messages.map((item) => <article className={`message message-${item.role}`} key={item.id}><b>{item.role === "user" ? "You" : "PR-0"}</b><MessageText content={item.content} /></article>)}
              {!messages.length && result && <article className="message message-agent"><b>Execution report</b><MessageText content={result} /></article>}
              {!messages.length && !result && !researchResult && !browserResult && <div className="welcome-state"><span className="welcome-mark" aria-hidden="true">PR-0</span><h2>What are we building?</h2><p>Describe a change, feature, or bug. Review the plan before execution, and approve any proposed file writes.</p><button className="text-action" onClick={() => setActiveView("plans")} type="button">Browse existing tasks</button></div>}
              {filePreview && <article className="result-panel file-preview"><div className="panel-heading"><b>{filePreview.path}</b><button aria-label="Close file preview" className="icon-button" onClick={() => setFilePreview(undefined)} type="button">×</button></div><pre>{filePreview.content}</pre></article>}
            </div>
            <div className="composer">
              <details className="composer-options"><summary>Task options <span>{agentRole} · {activeProvider?.id === "mock" ? "Mock provider" : providerId}</span></summary>
                <div className="option-grid">
                  <label>Provider<select aria-label="Model provider" value={providerId} onChange={(event) => chooseProvider(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.id === "mock" ? "Mock · explicit test mode" : provider.id === "ollama" ? `Ollama · local · ${provider.status?.replaceAll("_", " ") ?? "checking"}` : `${provider.id} API · configured`}</option>)}{unavailableProviders.map((id) => <option key={id} value={id} disabled>{id} · credentials missing</option>)}</select></label>
                  {providerId === "ollama" && activeProvider?.models?.length && !activeProvider.defaultModel
                    ? <label>Installed local model<select aria-label="Model id" value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Select installed model</option>{activeProvider.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
                    : providerId !== "mock" && <label>Model identifier<input aria-label="Model id" placeholder={activeProvider?.defaultModel ?? "Select or configure a model"} value={modelId} onChange={(event) => setModelId(event.target.value)} /></label>}
                  <label>Agent role<select aria-label="Agent role" value={agentRole} onChange={(event) => setAgentRole(event.target.value)}>{["orchestrator", "architect", "frontend", "backend", "debugger", "reviewer", "qa", "researcher", "documentation"].map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                  <label>Prerequisite<select aria-label="Task prerequisite" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">None</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} ({task.status})</option>)}</select></label>
                </div>
                <button className="secondary-button" disabled={providersLoading} onClick={() => void refreshProviders()} type="button">{providersLoading ? "Checking provider…" : "Refresh provider status"}</button>
                {providerId !== "mock" && !providerReady && <p className="inline-warning" role="status">{providerBlockedReason()} No provider fallback will be selected.</p>}
              </details>
              <label className="sr-only" htmlFor="task-prompt">Development task</label>
              <textarea id="task-prompt" aria-label="Development task" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!taskCreating) void send(); } }} placeholder="Describe the change you want to make…" />
              <div className="composer-footer">
                <details className="research-options"><summary>Research tools</summary><div className="research-tool-fields"><div className="web-research-controls"><label className="sr-only" htmlFor="research-url">Public HTTPS URL</label><input id="research-url" type="url" placeholder="https://public-site.example/article" value={researchUrl} onChange={(event) => setResearchUrl(event.target.value)} /><button className="secondary-button" disabled={!researchUrl.trim() || researching} onClick={() => void researchPublicPage()} type="button">{researching ? "Researching…" : "Research page"}</button></div><div className="browser-controls"><select aria-label="Browser action" value={browserAction} onChange={(event) => setBrowserAction(event.target.value as typeof browserAction)}><option value="inspect">Inspect page</option><option value="click">Click link or details</option><option value="fill">Fill text field</option></select>{browserAction !== "inspect" && <input aria-label="Browser selector" placeholder="#search" value={browserSelector} onChange={(event) => setBrowserSelector(event.target.value)} />}{browserAction === "fill" && <input aria-label="Browser text value" maxLength={512} placeholder="Text to fill locally" value={browserValue} onChange={(event) => setBrowserValue(event.target.value)} />}<button className="secondary-button" disabled={!researchUrl.trim() || browserRunning || (browserAction !== "inspect" && !browserSelector.trim())} onClick={() => void automateBrowser()} type="button">{browserRunning ? "Inspecting…" : "Inspect in browser"}</button></div></div></details>
                <span className="composer-hint">{active ? `${active.name} · Shift+Enter for a new line` : "Add a workspace to begin"}</span>
                <div className="composer-actions"><button className="secondary-button" onClick={() => void generatePlan()} disabled={!active || !message.trim() || planning || planRunActive || taskCreating || !providerReady} type="button">{planning ? "Planning…" : "Plan first"}</button><button className="primary-button" onClick={() => void send()} disabled={!active || !message.trim() || taskCreating} type="button">{taskCreating ? "Creating…" : "Create task"}</button></div>
              </div>
            </div>
          </section>
          <TaskQueuePanel tasks={tasks} visiblePlan={visiblePlan} planRunActive={planRunActive} completedPlanTasks={completedPlanTasks} runningPlanTasks={runningPlanTasks} waitingPlanTasks={waitingPlanTasks} failedPlanTasks={failedPlanTasks} blockedPlanTasks={blockedPlanTasks} cancelledPlanTasks={cancelledPlanTasks} tasksById={tasksById} dependentsByTaskId={dependentsByTaskId} runningTaskId={runningTaskId} providerReady={providerReady} onRun={(taskId) => { const task = tasksById.get(taskId); if (task) void run(task); }} onCancel={(taskId) => { const task = tasksById.get(taskId); if (task) void cancel(task); }} onRunPlan={() => void runPlan()} />
        </div>}

        {activeView === "plans" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">EXECUTION</p><h2>Plans & tasks</h2><p>Review dependencies and run ready tasks. Progress reflects persisted task states.</p>{!providerReady && <p className="inline-warning" role="status">{providerBlockedReason()} Refresh provider status or choose an installed model before execution.</p>}</div><TaskQueuePanel tasks={tasks} visiblePlan={visiblePlan} planRunActive={planRunActive} completedPlanTasks={completedPlanTasks} runningPlanTasks={runningPlanTasks} waitingPlanTasks={waitingPlanTasks} failedPlanTasks={failedPlanTasks} blockedPlanTasks={blockedPlanTasks} cancelledPlanTasks={cancelledPlanTasks} tasksById={tasksById} dependentsByTaskId={dependentsByTaskId} runningTaskId={runningTaskId} providerReady={providerReady} onRun={(taskId) => { const task = tasksById.get(taskId); if (task) void run(task); }} onCancel={(taskId) => { const task = tasksById.get(taskId); if (task) void cancel(task); }} onRunPlan={() => void runPlan()} /></section>}

        {activeView === "files" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">WORKSPACE</p><h2>Files</h2><p>Browse and search text in the active registered workspace.</p></div><div className="file-workspace"><section className="tool-section"><div className="file-toolbar"><button className="secondary-button" disabled={explorerPath === "." || !active} onClick={() => { const parent = explorerPath.split("/").slice(0, -1).join("/") || "."; void loadWorkspaceDirectory(parent); }} type="button">Up one level</button><span className="path-label">{explorerPath}</span><label className="sr-only" htmlFor="file-search">Search workspace files</label><input id="file-search" value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchWorkspace(); }} placeholder="Search workspace files" /><button className="secondary-button" disabled={!active || !fileSearch.trim()} onClick={() => void searchWorkspace()} type="button">Search</button></div><div className="file-list" aria-label="Workspace files">
              {searchMatches.length ? searchMatches.map((match) => <button className="file-entry" key={`${match.path}:${match.line}`} onClick={() => void openWorkspaceFile(match.path)} type="button"><span aria-hidden="true">F</span><span>{match.path}:{match.line}</span><small>{match.text}</small></button>) : fileEntries.map((entry) => <button aria-disabled={entry.type === "symlink" || entry.type === "other"} className="file-entry" key={entry.path} disabled={entry.type === "symlink" || entry.type === "other"} onClick={() => entry.type === "directory" ? void loadWorkspaceDirectory(entry.path) : entry.type === "file" ? void openWorkspaceFile(entry.path) : undefined} type="button"><span aria-hidden="true">{entry.type === "directory" ? "D" : "F"}</span><span title={entry.path}>{entry.name}</span></button>)}</div>{!fileEntries.length && !searchMatches.length && <div className="empty-state">No entries in this directory.</div>}</section><section className="tool-section file-content"><h3>Preview</h3>{filePreview ? <><div className="path-label">{filePreview.path}</div><pre>{filePreview.content}</pre></> : <div className="empty-state">Select a text file to preview it. Files flagged as sensitive are excluded by the API.</div>}</section></div></section>}

        {activeView === "approvals" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">HUMAN REVIEW</p><h2>Approvals <span className="count-badge">{approvals.length}</span></h2><p>Pending operations have not run yet. Review the target and proposed content before deciding.</p></div><ApprovalInbox approvals={approvals} busyId={approvalBusyId} onDecision={decideApproval} /></section>}

        {activeView === "terminal" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">SUPERVISED EXECUTION</p><h2>Terminal</h2><p>Commands use an allowlist and require approval in supervised mode. Review each command before it runs.</p></div><section className="tool-section"><div className="terminal-controls"><label>Task<select aria-label="Task for terminal session" value={terminalTaskId} onChange={(event) => setTerminalTaskId(event.target.value)}><option value="">Select task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>Executable<select aria-label="Terminal executable" value={terminalExecutable} onChange={(event) => setTerminalExecutable(event.target.value)}>{["node", "npm", "npx", "git"].map((executable) => <option key={executable} value={executable}>{executable}</option>)}</select></label><label className="terminal-args">Arguments<textarea aria-label="Terminal arguments" value={terminalArguments} onChange={(event) => setTerminalArguments(event.target.value)} placeholder="One argument per line" /></label><button className="primary-button" disabled={!active || !terminalTaskId} onClick={() => void startTerminal()} type="button">Request approval to run</button></div></section>{terminalSessions.length ? terminalSessions.map((session) => <article className="terminal-session" key={session.id}><div className="session-heading"><div><b>{session.executable} {session.args.join(" ")}</b><span className={`session-state status-${session.status}`}>{session.status}{session.exitCode === null ? "" : ` · exit ${session.exitCode}`}</span></div>{session.status === "running" && <button className="secondary-button" onClick={() => void stopTerminal(session)} type="button">Stop session</button>}<button className="secondary-button" onClick={() => void navigator.clipboard.writeText(session.output)} type="button">Copy output</button></div><pre>{session.output || "Waiting for process output…"}</pre></article>) : <div className="empty-state">No terminal sessions for this workspace.</div>}</section>}

        {activeView === "source-control" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">GIT</p><h2>Source control</h2><p>Inspect working changes, patches, history, and recovery checkpoints. PR-0 does not discard uncommitted changes.</p></div><section className="tool-section"><div className="section-toolbar"><button className="secondary-button" disabled={!active} onClick={() => void refreshGitStatus()} type="button">Refresh status</button><button className="secondary-button" disabled={!active} onClick={() => void createGitCheckpoint()} type="button">Create clean checkpoint</button>{gitStatus && <span className="branch-label">Branch · {gitStatus.branch}</span>}</div>{gitError && <p className="inline-error" role="alert">{gitError}</p>}{gitStatus?.changes.length ? <div className="change-list">{gitStatus.changes.map((change) => <div className="change-row" key={change.path}><code>{change.status || "?"}</code><span>{change.path}</span></div>)}</div> : <p className="empty-state">No working-tree changes reported.</p>}{gitDiff?.files.length ? <div className="change-list">{gitDiff.files.map((file) => <div className="change-row" key={`${file.path}:${file.staged}`}><span className="change-kind">{file.staged ? "Staged" : "Working tree"}</span><span>{file.path}</span><span>+{file.added ?? "binary"} / -{file.deleted ?? "binary"}</span></div>)}</div> : null}</section><details className="git-view" open><summary>Patch review</summary>{gitPatch ? <><div className="git-actions"><button aria-pressed={gitPatchView === "unstaged"} onClick={() => setGitPatchView("unstaged")} type="button">Working tree</button><button aria-pressed={gitPatchView === "staged"} onClick={() => setGitPatchView("staged")} type="button">Staged</button></div><small>{gitPatch[gitPatchView].files.length} files{gitPatch[gitPatchView].truncated ? " · patch truncated" : ""}</small><pre className="git-patch">{gitPatch[gitPatchView].patch || "No patch available."}</pre></> : <p className="empty-state">Refresh Git status to load patch data.</p>}</details><details className="git-view"><summary>Commit history {gitHistoryTruncated ? "· latest 25" : `· ${gitHistory.length}`}</summary>{gitHistory.map((commit) => <div className="git-commit" key={commit.hash}><b>{commit.shortHash} · {commit.subject}</b><small>{commit.author} · {commit.authoredAt}</small></div>)}</details><section className="tool-section"><h3>Recovery checkpoints</h3>{gitCheckpoints.length ? gitCheckpoints.map((checkpoint) => <div className="git-checkpoint" key={checkpoint.id}><b>{checkpoint.shortHash}</b><small>{checkpoint.subject} · {checkpoint.createdAt}</small><button className="secondary-button" onClick={() => void previewGitRollback(checkpoint)} type="button">Preview rollback</button></div>) : <p className="empty-state">No checkpoints are available.</p>}{rollbackPreview && <div className="rollback-preview"><b>Rollback preview · {rollbackPreview.branch}</b><small>{rollbackPreview.commits.length} commits · {rollbackPreview.files.length} changed files{rollbackPreview.truncated ? " · preview truncated" : ""}</small>{rollbackPreview.commits.slice(0, 5).map((commit) => <small key={commit.hash}>{commit.shortHash} · {commit.subject}</small>)}{rollbackPreview.files.slice(0, 10).map((path) => <small key={path}>{path}</small>)}<div className="git-actions"><button onClick={() => setRollbackPreview(null)} type="button">Cancel</button><button disabled={!rollbackPreview.commits.length} onClick={() => void rollbackGitCheckpoint()} type="button">Review rollback…</button></div></div>}</section></section>}

        {activeView === "todos" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">PROJECT</p><h2>TODOs</h2><p>Manual project TODOs are separate from agent task execution.</p></div><section className="tool-section"><div className="todo-tools"><label>Title<input aria-label="TODO title" value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="TODO title" /></label><label>Description<input aria-label="TODO description" value={todoDescription} onChange={(event) => setTodoDescription(event.target.value)} placeholder="What needs doing?" /></label><label>Priority<input aria-label="TODO priority" type="number" min="0" max="100" value={todoPriority} onChange={(event) => setTodoPriority(Number(event.target.value))} /></label><label>Acceptance criteria<textarea aria-label="TODO criteria" value={todoCriteria} onChange={(event) => setTodoCriteria(event.target.value)} placeholder="One criterion per line" /></label><div className="form-actions"><button className="primary-button" disabled={!todoTitle.trim()} onClick={() => void saveTodo()} type="button">{editingTodoId ? "Save TODO" : "Add TODO"}</button>{editingTodoId && <button className="secondary-button" onClick={() => { setEditingTodoId(undefined); setTodoTitle(""); setTodoDescription(""); setTodoPriority(0); setTodoCriteria(""); }} type="button">Cancel edit</button>}</div></div></section><div className="todo-list">{todos.length ? todos.map((todo) => <article className="todo-item" key={todo.id}><div><b>{todo.title}</b><small>{todo.description || "No description"} · Priority {todo.priority} · {todo.status}</small>{todo.acceptanceCriteria.map((criterion) => <small key={criterion}>- {criterion}</small>)}</div><div className="approval-actions"><button onClick={() => editTodo(todo)} type="button">Edit</button><button onClick={() => void updateTodoStatus(todo)} type="button">{todo.status === "open" ? "Complete" : "Reopen"}</button><button onClick={() => void deleteTodo(todo)} type="button">Delete</button></div></article>) : <div className="empty-state">No TODOs yet. Add a task to track a project-level follow-up.</div>}</div></section>}

        {activeView === "memory" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">PROJECT CONTEXT</p><h2>Project memory</h2><p>Store verified facts, decisions, or outcomes. Credential-like values are rejected by the server.</p></div><section className="tool-section"><div className="memory-form"><label>Note type<select aria-label="Memory type" value={memoryKind} onChange={(event) => setMemoryKind(event.target.value as MemoryNote["kind"])}><option value="fact">Fact</option><option value="decision">Decision</option><option value="outcome">Outcome</option></select></label><label>Verified project note<textarea aria-label="Project memory content" value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder="Record a verified project note" /></label><div className="form-actions"><button className="primary-button" disabled={!memoryContent.trim()} onClick={() => void saveMemory()} type="button">{editingMemoryId ? "Save note" : "Add note"}</button>{editingMemoryId && <button className="secondary-button" onClick={() => { setEditingMemoryId(undefined); setMemoryContent(""); }} type="button">Cancel edit</button>}</div></div></section><div className="memory-list">{memories.length ? memories.map((memory) => <article className="memory-item" key={memory.id}><div><small>{memory.kind} · updated {new Date(memory.updatedAt).toLocaleString()}</small><p>{memory.content}</p></div><div className="approval-actions"><button onClick={() => editMemory(memory)} type="button">Edit</button><button onClick={() => void deleteMemory(memory)} type="button">Delete</button></div></article>) : <div className="empty-state">No project memory yet.</div>}</div></section>}

        {activeView === "usage" && <section className="tool-view"><div className="view-intro"><p className="eyebrow">PROJECT</p><h2>Model usage</h2><p>Provider-reported usage and cost estimates; these are not billing records.</p></div>{usage ? <div className="usage-grid"><article><small>Requests</small><strong>{usage.requests}</strong></article><article><small>Input tokens</small><strong>{usage.inputTokens.toLocaleString()}</strong></article><article><small>Output tokens</small><strong>{usage.outputTokens.toLocaleString()}</strong></article><article><small>Estimated cost</small><strong>${usage.estimatedCostUsd.toFixed(4)}</strong></article><p>{usage.unknownCostRequests} requests have unknown cost.</p></div> : <div className="empty-state">Usage data is not available for this workspace.</div>}</section>}
      </main>

      {projectDialogOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !projectCreating) setProjectDialogOpen(false); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><div className="dialog-heading"><div><p className="eyebrow">WORKSPACE</p><h2 id="project-dialog-title">Add workspace</h2></div><button className="icon-button" aria-label="Close dialog" disabled={projectCreating} onClick={() => setProjectDialogOpen(false)} type="button">×</button></div><p>Register an existing directory. PR-0 will not create or move files for you.</p><label>Workspace name<input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} /></label><label>Existing directory path<input value={newProjectPath} onChange={(event) => setNewProjectPath(event.target.value)} placeholder="/home/you/projects/example" /></label>{projectError && <p className="inline-error" role="alert">{projectError}</p>}<div className="dialog-actions"><button className="secondary-button" disabled={projectCreating} onClick={() => setProjectDialogOpen(false)} type="button">Cancel</button><button className="primary-button" disabled={projectCreating || !newProjectName.trim() || !newProjectPath.trim()} onClick={() => void createProject()} type="button">{projectCreating ? "Adding…" : "Add workspace"}</button></div></section></div>}
    </div>
  );
}
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element was not found");
const root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<StrictMode><App /></StrictMode>);
