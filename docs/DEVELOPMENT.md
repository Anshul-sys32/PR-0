# Development

Requires Node.js 22 or later because the local database adapter uses `node:sqlite`.

Browser automation uses Playwright-managed Chromium. After installing npm dependencies, install the browser runtime with `npx playwright install chromium`.

Use `npm run dev` for the API and frontend together. Use `npm run db:init` to create the local database. `npm test`, `npm run typecheck`, and `npm run build` are the project verification commands.

The test suite uses isolated temporary database files and the mock model. It does not make paid provider calls.
