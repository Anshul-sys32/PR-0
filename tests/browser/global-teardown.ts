import { rmSync } from "node:fs";

export default async function globalTeardown(): Promise<void> {
  const root = process.env.PR0_BROWSER_TEST_ROOT;
  if (root) rmSync(root, { recursive: true, force: true });
}
