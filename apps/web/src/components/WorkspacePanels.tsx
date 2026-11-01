import type { ReactNode } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  role: string;
  dependencies?: string[];
  retryAttempts?: number;
  execution?: { retryAttempts?: number } | null;
};
type TaskPlan = { id: string; projectId: string; summary: string; tasks: Task[] };
type Approval = {
  id: string;
  taskId: string;
  action: string;
  risk: string;
  operationKind: string | null;
  createdAt: string;
  preview?: { path: string; content: string; contentTruncated: boolean; overwrite: boolean };
};

type TaskQueuePanelProps = {
  tasks: Task[];
  visiblePlan: TaskPlan | null;
  planRunActive: boolean;
  completedPlanTasks: number;
  runningPlanTasks: number;
  waitingPlanTasks: number;
  failedPlanTasks: number;
  blockedPlanTasks: number;
  cancelledPlanTasks: number;
  tasksById: Map<string, Task>;
  dependentsByTaskId: Map<string, string[]>;
  runningTaskId?: string;
  providerReady: boolean;
  onRun: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRunPlan: () => void;
};

export function TaskQueuePanel({
  tasks, visiblePlan, planRunActive, completedPlanTasks, runningPlanTasks, waitingPlanTasks,
  failedPlanTasks, blockedPlanTasks, cancelledPlanTasks, tasksById, dependentsByTaskId,
  runningTaskId, providerReady, onRun, onCancel, onRunPlan
}: TaskQueuePanelProps) {
  return (
    <section className="activity-panel" aria-label="Task plan and execution queue">
      {visiblePlan && <section className="plan-section">
        <div className="plan-progress">
          <div className="plan-progress-copy">
            <b>{visiblePlan.summary}</b>
            <small>{completedPlanTasks}/{visiblePlan.tasks.length} complete · {runningPlanTasks} running · {waitingPlanTasks} ready · {failedPlanTasks} failed · {blockedPlanTasks} blocked · {cancelledPlanTasks} cancelled</small>
          </div>
          <button className="secondary-button" disabled={!providerReady || planRunActive || waitingPlanTasks === 0} onClick={onRunPlan} type="button">{planRunActive ? "Running plan…" : "Run plan"}</button>
          <progress aria-label="Completed plan tasks" max={visiblePlan.tasks.length} value={completedPlanTasks} />
        </div>
        <ol className="plan-flow" aria-label="Task dependency flow">
          {visiblePlan.tasks.map((task, index) => {
            const prerequisites = (task.dependencies ?? []).map((id) => visiblePlan.tasks.find((candidate) => candidate.id === id)?.title ?? "Unknown task");
            return <li className={`plan-flow-item status-${task.status}`} key={task.id}><span className="plan-step">{index + 1}</span><div><b>{task.title}</b><small>{task.role} · {task.status}{prerequisites.length ? ` · after ${prerequisites.join(", ")}` : " · no prerequisites"}</small></div></li>;
          })}
        </ol>
      </section>}
      <div className="queue-heading"><h2>Execution queue</h2><span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span></div>
      <div className="task-list">
        {tasks.length ? tasks.map((task) => {
          const prerequisites = (task.dependencies ?? []).map((id) => tasksById.get(id)?.title ?? "Missing task");
          const dependents = dependentsByTaskId.get(task.id) ?? [];
          const retries = task.retryAttempts ?? task.execution?.retryAttempts ?? 0;
          return <article className="task-row" key={task.id}>
            <span className={`task-status-mark status-${task.status}`} aria-hidden="true" />
            <div className="task-copy"><b>{task.title}</b><small>{task.role} · <span className={`text-status status-${task.status}`}>{task.status.replaceAll("_", " ")}</span>{retries > 0 ? ` · ${retries} retries` : ""}</small>{prerequisites.length > 0 && <small className="task-relations">Depends on: {prerequisites.join(", ")}</small>}{dependents.length > 0 && <small className="task-relations">Unlocks: {dependents.join(", ")}</small>}</div>
            {task.status === "ready" && <button className="secondary-button" disabled={!providerReady || Boolean(runningTaskId) || planRunActive} onClick={() => onRun(task.id)} type="button">Run</button>}
            {runningTaskId === task.id && <button className="secondary-button" onClick={() => onCancel(task.id)} type="button">Stop</button>}
          </article>;
        }) : <div className="empty-state">No execution tasks yet. Create a task in Agent to begin.</div>}
      </div>
    </section>
  );
}

type ApprovalInboxProps = {
  approvals: Approval[];
  busyId?: string;
  onDecision: (approval: Approval, approved: boolean) => void;
};

export function ApprovalInbox({ approvals, busyId, onDecision }: ApprovalInboxProps) {
  if (!approvals.length) return <div className="empty-state">No pending approvals. Proposed changes and supervised commands appear here before they run.</div>;
  return <div className="approval-list">{approvals.map((approval) => <article className="approval-item" key={approval.id}>
    <div className="approval-heading"><div><b>{approval.action}</b><small>{approval.operationKind ?? "operation"} · {approval.risk} · requested {new Date(approval.createdAt).toLocaleString()}</small></div><span className="approval-state">Pending</span></div>
    {approval.preview && <><div className="approval-target"><span>Target</span><code>{approval.preview.path}</code><span>{approval.preview.overwrite ? "Existing file may be overwritten" : "Create only; existing files are preserved"}</span></div><details className="approval-preview"><summary>Review proposed contents{approval.preview.contentTruncated ? " · preview truncated" : ""}</summary><pre>{approval.preview.content}</pre></details></>}
    <div className="approval-actions"><button className="primary-button" disabled={Boolean(busyId)} onClick={() => onDecision(approval, true)} type="button">{busyId === approval.id ? "Saving…" : "Approve operation"}</button><button className="secondary-button" disabled={Boolean(busyId)} onClick={() => onDecision(approval, false)} type="button">Reject</button></div>
  </article>)}</div>;
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="tool-section"><h3>{title}</h3>{children}</section>;
}
