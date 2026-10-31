import { describe, expect, it } from "vitest";
import { agentRoles } from "@pr-0/shared";
import { loadAgentPrompt } from "@pr-0/agent-core";

describe("agent prompt loader", () => {
  const roleTitles: Record<(typeof agentRoles)[number], string> = {
    orchestrator: "ORCHESTRATOR",
    architect: "SOFTWARE ARCHITECT",
    frontend: "FRONTEND ENGINEER",
    backend: "BACKEND ENGINEER",
    debugger: "DEBUGGING SPECIALIST",
    reviewer: "INDEPENDENT CODE REVIEWER",
    qa: "QUALITY ASSURANCE ENGINEER",
    researcher: "TECHNICAL RESEARCH SPECIALIST",
    documentation: "DOCUMENTATION ENGINEER"
  };

  it.each(agentRoles)("combines shared and %s role instructions", async (role) => {
    const prompt = await loadAgentPrompt(role);
    expect(prompt).toContain("specialized AI agent operating inside Project PR-0");
    expect(prompt).toContain(`ROLE: ${roleTitles[role]}`);
  });
});