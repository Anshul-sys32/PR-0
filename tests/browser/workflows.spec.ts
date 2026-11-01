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
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Memory browser workflow" })).toBeVisible();

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
  await expect(page.locator(".connection")).toContainText("Credential-like values cannot be stored");
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
  const rejectedApproval = page.locator(".approval-item").filter({ hasText: "Write rejected.txt" });
  await expect(rejectedApproval).toBeVisible();
  await rejectedApproval.getByRole("button", { name: "Reject" }).click();
  await expect(rejectedApproval).toHaveCount(0);
  expect(existsSync(join(root, "rejected.txt"))).toBe(false);
});
