import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@pr-0/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
      "@pr-0/model-gateway": new URL("./packages/model-gateway/src/index.ts", import.meta.url).pathname,
      "@pr-0/tool-runtime": new URL("./packages/tool-runtime/src/index.ts", import.meta.url).pathname,
      "@pr-0/agent-core": new URL("./packages/agent-core/src/index.ts", import.meta.url).pathname
    }
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" }
});
