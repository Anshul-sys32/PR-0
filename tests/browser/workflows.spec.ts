import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";

const workspaceRoot = join(process.cwd(), "data", "browser-test-workspaces");
test.afterEach(() => rmSync(workspaceRoot, { recursive: true, force: true }));

test("memory UI adds, edits, deletes, and rejects credential-like notes", async ({ page, request }) => {
  const root = join(workspaceRoot, "memory");
  mkdirSync(root, { recursive: true });
  const created = await request.post("/api/projects", { data: { name: "Memory browser workflow", rootPath: root } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await page.goto("/");
  await page.getByLabel("Active workspace").selectOption(projectId);
  await expect(page.locator(".topbar-title small")).toHaveText("Memory browser workflow");
  await page.getByRole("button", { name: "Memory", exact: true }).click();

  const content = page.getByRole("textbox", { name: "Project memory content" });
  await content.fill("The service stores tasks in SQLite.");
  await page.getByRole("button", { name: "Add note" }).click();
  const note = page.locator(".memory-item").filter({ hasText: "The service stores tasks in SQLite." });
  await expect(note).toBeVisible();

  await note.getByRole("button", { name: "Edit" }).click();
  await content.fill("The service uses SQLite for local task persistence.");
  await page.getByRole("button", { name: "Save note" }).click();
  const updatedNote = page.locator(".memory-item").filter({ hasText: "The service uses SQLite for local task persistence." });
  await expect(updatedNote).toBeVisible();

  await content.fill("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.locator(".connection-state")).toContainText("Credential-like values cannot be stored");
  await expect(page.locator(".memory-item")).toHaveCount(1);

  await updatedNote.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".memory-item")).toHaveCount(0);
});

test("approval UI previews and applies a proposed write, and rejection leaves files unchanged", async ({ page, request }) => {
  const root = join(workspaceRoot, "approvals");
  mkdirSync(root, { recursive: true });
  const created = await request.post("/api/projects", { data: { name: "Approval browser workflow", rootPath: root } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const conversationResponse = await request.post("/api/conversations", { data: { projectId } });
  const conversationId = (await conversationResponse.json()).conversation.id as string;
  const taskResponse = await request.post(`/api/conversations/${conversationId}/messages`, { data: { content: "Implement a reviewed sample file" } });
  const taskId = (await taskResponse.json()).task.id as string;

  const approvalResponse = await request.post("/api/files/write", { data: { taskId, projectId, path: "approved.txt", content: "approved browser content", mode: "supervised" } });
  expect(approvalResponse.status()).toBe(202);
  await page.goto("/");
  await page.getByLabel("Active workspace").selectOption(projectId);
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  const approval = page.locator(".approval-item").filter({ hasText: "Write approved.txt" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("filesystem.write");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => existsSync(join(root, "approved.txt"))).toBe(true);
  expect(readFileSync(join(root, "approved.txt"), "utf8")).toBe("approved browser content");

  const rejectedTaskResponse = await request.post(`/api/conversations/${conversationId}/messages`, { data: { content: "Propose a file that will be rejected" } });
  const rejectedTaskId = (await rejectedTaskResponse.json()).task.id as string;
  const rejectedApprovalResponse = await request.post("/api/files/write", { data: { taskId: rejectedTaskId, projectId, path: "rejected.txt", content: "must not be written", mode: "supervised" } });
  expect(rejectedApprovalResponse.status()).toBe(202);
  await page.reload();
  await page.getByLabel("Active workspace").selectOption(projectId);
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  const rejectedApproval = page.locator(".approval-item").filter({ hasText: "Write rejected.txt" });
  await expect(rejectedApproval).toBeVisible();
  await rejectedApproval.getByRole("button", { name: "Reject" }).click();
  await expect(rejectedApproval).toHaveCount(0);
  expect(existsSync(join(root, "rejected.txt"))).toBe(false);
});

test("agent workflow creates and runs a task, with grouped navigation at desktop and mobile widths", async ({ page, request }) => {
  const root = join(workspaceRoot, "agent-workflow");
  mkdirSync(root, { recursive: true });
  const created = await request.post("/api/projects", { data: { name: "Agent workflow workspace", rootPath: root } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await page.goto("/");
  await page.getByLabel("Active workspace").selectOption(projectId);
  await expect(page.locator(".topbar-title small")).toHaveText("Agent workflow workspace");
  await expect(page.getByLabel("Model provider")).toHaveValue("ollama");
  await page.locator(".composer-options summary").click();
  await expect(page.getByLabel("Free-only mode")).toBeChecked();
  await page.getByLabel("Local-only mode").check();
  await expect(page.getByLabel("Local-only mode")).toBeChecked();
  await page.getByLabel("Local-only mode").uncheck();
  await page.getByLabel("Model provider").selectOption("mock");

  await page.getByRole("textbox", { name: "Development task" }).fill("Explain the `workspace` and **report** one useful next step");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.locator(".message-user code")).toHaveText("workspace");
  await expect(page.locator(".message-user strong")).toHaveText("report");
  await expect(page.getByText("Task ready — run it when you are ready.")).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("Task completed with mock / mock.")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Plans & tasks", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Plans & tasks" })).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Files" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation" }).click();

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow, `horizontal overflow at ${width}px`).toBe(false);
    if (width <= 800) {
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("navigation", { name: "Build" })).toBeVisible();
      await page.getByRole("button", { name: "Terminal", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Terminal" })).toBeVisible();
    }
  }
});

test("workspace creation uses the app dialog and preserves validation context", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Workspace name").fill("Dialog workspace");
  await dialog.getByLabel("Existing directory path").fill(join(workspaceRoot, "missing-directory"));
  await dialog.getByRole("button", { name: "Add workspace" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Workspace name")).toHaveValue("Dialog workspace");
  await expect(dialog.getByLabel("Existing directory path")).toHaveValue(join(workspaceRoot, "missing-directory"));
});
