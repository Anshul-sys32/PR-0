import { access, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";

export function safeWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) throw new Error("Absolute paths are not permitted");
  const candidate = resolve(workspaceRoot, requestedPath);
  if (!isWithin(workspaceRoot, candidate)) throw new Error("Path escapes the authorized workspace");
  return candidate;
}
export async function verifyResolvedPath(workspaceRoot: string, candidate: string): Promise<string> {
  const [root, target] = await Promise.all([realpath(workspaceRoot), realpath(candidate)]);
  if (!isWithin(root, target)) throw new Error("Resolved path escapes the authorized workspace");
  return target;
}
export async function verifyWritePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const candidate = safeWorkspacePath(workspaceRoot, requestedPath);
  const parent = dirname(candidate);
  await access(parent);
  const [root, resolvedParent] = await Promise.all([realpath(workspaceRoot), realpath(parent)]);
  if (!isWithin(root, resolvedParent)) throw new Error("Write target escapes the authorized workspace");
  return candidate;
}
export function isWithin(workspaceRoot: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(workspaceRoot), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && pathFromRoot !== "..");
}
export function isSensitiveFilePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  const name = segments.at(-1) ?? "";
  return segments.some((segment) => [".ssh", ".aws", ".azure", ".gnupg"].includes(segment))
    || name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") || name.endsWith(".key")
    || name === "id_rsa" || name === "id_ed25519" || name.includes("credentials") || name.includes("secrets");
}
export type Risk = "low" | "consequential" | "destructive";
export function requiresApproval(mode: "ask-first" | "supervised" | "autonomous", risk: Risk): boolean { return risk === "destructive" || (mode === "ask-first" && risk !== "low") || (mode === "supervised" && risk === "consequential"); }
