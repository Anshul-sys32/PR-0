# Development

Requires Node.js 22 or later because the local database adapter uses `node:sqlite`, plus npm. Browser tests use Playwright-managed Chromium.

Install dependencies and the browser runtime:

```sh
npm install
npx playwright install chromium
```

Run `npm run dev` for the API and frontend together. The API defaults to `127.0.0.1:5000`, the web app to Vite's `localhost:5173`, and SQLite data to `data/pr-0.db`. Use `npm run db:init` to initialize the configured database. See [PROVIDERS.md](PROVIDERS.md) for server-side provider configuration. Cloud credentials are optional; the mock adapter is the default and is used by tests.

The verification commands are `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:browser`. Tests use isolated temporary databases and deterministic/mock adapters; they do not make paid provider calls. Browser tests launch local test servers and Chromium.
