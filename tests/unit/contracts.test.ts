import { describe, expect, it } from "vitest";
import { canTransition, agentResultSchema } from "@pr-0/shared";
import { isSensitiveFilePath, isWithin, safeWorkspacePath, requiresApproval } from "@pr-0/tool-runtime";

describe("task contracts", () => {
  it("only allows declared state transitions", () => { expect(canTransition("ready", "running")).toBe(true); expect(canTransition("completed", "running")).toBe(false); });
  it("rejects malformed agent results", () => { expect(() => agentResultSchema.parse({ taskId: "x", status: "completed" })).toThrow(); });
});
describe("tool security primitives", () => {
  it("rejects workspace path escapes", () => { expect(() => safeWorkspacePath("/tmp/workspace", "../secret")).toThrow(); });
  it("does not accept a sibling path with a matching prefix", () => { expect(isWithin("/tmp/workspace", "/tmp/workspace-other")).toBe(false); });
  it("keeps destructive work approval-gated", () => { expect(requiresApproval("autonomous", "destructive")).toBe(true); });
  it("blocks credentials from model-readable project files", () => { expect(isSensitiveFilePath("config/.env.local")).toBe(true); expect(isSensitiveFilePath("src/main.ts")).toBe(false); });
});
