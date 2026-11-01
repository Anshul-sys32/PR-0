import type { ReactNode } from "react";

export type WorkspaceView = "agent" | "plans" | "files" | "terminal" | "source-control" | "todos" | "memory" | "usage" | "approvals";

type ProjectOption = { id: string; name: string };
type ConversationOption = { id: string };

type SidebarProps = {
  projects: ProjectOption[];
  activeProjectId?: string;
  conversations: ConversationOption[];
  activeConversationId?: string;
  pendingApprovalCount: number;
  view: WorkspaceView;
  collapsed: boolean;
  mobileOpen: boolean;
  onProjectChange: (projectId: string) => void;
  onConversationChange: (conversationId: string) => void;
  onNewProject: () => void;
  onNewTask: () => void;
  onNavigate: (view: WorkspaceView) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
};

type NavItem = { id: WorkspaceView; label: string; mark: string };
type NavGroupProps = {
  title: string;
  items: NavItem[];
  active: WorkspaceView;
  collapsed: boolean;
  badgeCount?: number;
  onNavigate: (view: WorkspaceView) => void;
};

function NavGroup({ title, items, active, collapsed, badgeCount = 0, onNavigate }: NavGroupProps) {
  return (
    <section className="nav-group" aria-label={title}>
      {!collapsed && <h2>{title}</h2>}
      <nav aria-label={title}>
        {items.map((item) => (
          <button
            aria-current={active === item.id ? "page" : undefined}
            aria-label={item.label}
            className={active === item.id ? "nav-link selected" : "nav-link"}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
            type="button"
          >
            <span className="nav-mark" aria-hidden="true">{item.mark}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
            {item.id === "approvals" && badgeCount > 0 && <span className="nav-count" aria-label={`${badgeCount} pending`}>{badgeCount}</span>}
          </button>
        ))}
      </nav>
    </section>
  );
}

export function Sidebar({
  projects, activeProjectId, conversations, activeConversationId, pendingApprovalCount, view, collapsed, mobileOpen,
  onProjectChange, onConversationChange, onNewProject, onNewTask, onNavigate, onToggleCollapsed, onCloseMobile
}: SidebarProps) {
  const groups: Array<{ title: string; items: NavItem[] }> = [
    { title: "Build", items: [
      { id: "agent", label: "Agent", mark: "AG" },
      { id: "plans", label: "Plans & tasks", mark: "PL" },
      { id: "files", label: "Files", mark: "FI" },
      { id: "terminal", label: "Terminal", mark: "TE" },
      { id: "source-control", label: "Source control", mark: "SC" }
    ] },
    { title: "Project", items: [
      { id: "todos", label: "TODOs", mark: "TD" },
      { id: "memory", label: "Memory", mark: "ME" },
      { id: "usage", label: "Usage", mark: "US" }
    ] },
    { title: "Review", items: [{ id: "approvals", label: "Approvals", mark: "AP" }] }
  ];
  const nav = (nextView: WorkspaceView) => {
    onNavigate(nextView);
    onCloseMobile();
  };
  const contents: ReactNode = (
    <>
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">PR</span>
        {!collapsed && <div><strong>PR-0</strong><small>Local coding workspace</small></div>}
        <button className="sidebar-collapse" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={onToggleCollapsed} type="button">{collapsed ? ">" : "<"}</button>
      </div>
      <div className="workspace-switcher">
        {!collapsed && <label htmlFor="workspace-select">Workspace</label>}
        <select id="workspace-select" aria-label="Active workspace" value={activeProjectId ?? ""} onChange={(event) => onProjectChange(event.target.value)}>
          <option value="">Select workspace</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        {!collapsed && <button className="quiet-button new-project" onClick={onNewProject} type="button">+ Add workspace</button>}
      </div>
      <button className="new-task-button" onClick={() => { onNewTask(); nav("agent"); }} type="button">
        <span aria-hidden="true">+</span>{!collapsed && "New task"}
      </button>
      <div className="sidebar-navigation">
        {groups.map((group) => <NavGroup key={group.title} {...group} active={view} collapsed={collapsed} badgeCount={pendingApprovalCount} onNavigate={nav} />)}
      </div>
      {!collapsed && <details className="recent-conversations" open>
        <summary>Recent conversations</summary>
        <div className="conversation-links">
          {conversations.map((conversation, index) => (
            <button
              aria-current={activeConversationId === conversation.id ? "page" : undefined}
              className={activeConversationId === conversation.id ? "conversation-link selected" : "conversation-link"}
              key={conversation.id}
              onClick={() => { onConversationChange(conversation.id); nav("agent"); }}
              type="button"
            >Conversation {conversations.length - index}</button>
          ))}
          {!conversations.length && <small>No conversations yet</small>}
        </div>
      </details>}
      <div className="sidebar-safety"><span className="status-dot" aria-hidden="true" />{!collapsed && <span>Local API · loopback</span>}</div>
    </>
  );

  return (
    <>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={onCloseMobile} type="button" />}
      <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`} aria-label="Workspace navigation">
        {contents}
      </aside>
    </>
  );
}
