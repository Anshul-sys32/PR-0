import { readFile } from "node:fs/promises";
import type { AgentRole } from "@pr-0/shared";

const promptsDirectory = new URL("../../../prompts/", import.meta.url);
const sharedPrompt = readFile(new URL("core/base-agent.md", promptsDirectory), "utf8");
const promptCache = new Map<AgentRole, Promise<string>>();

export function loadAgentPrompt(role: AgentRole): Promise<string> {
  const cached = promptCache.get(role);
  if (cached) return cached;
  const prompt = Promise.all([
    sharedPrompt,
    readFile(new URL(`agents/${role}.md`, promptsDirectory), "utf8")
  ]).then(([base, specialized]) => `${base.trim()}\n\n${specialized.trim()}`);
  promptCache.set(role, prompt);
  return prompt;
}