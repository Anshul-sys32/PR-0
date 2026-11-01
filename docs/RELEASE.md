# Release Readiness

PR-0 is currently an early local-development MVP, not a production-ready hosted service. Treat a release as suitable only for a trusted developer's local workspace until authentication, multi-user isolation, and deployment hardening are implemented.

## Pre-release checks

Run from the repository root with Node.js 22 or later:

```sh
npm install
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run test:browser
git diff --check
```

Unit and integration tests use isolated databases and mock adapters. Browser tests require Chromium and local process/network binding support. These checks do not verify paid-provider connectivity or arbitrary external websites.

## Operator requirements

- Keep `HOST` bound to `127.0.0.1`; the API has no caller authentication, and CORS is not an authorization mechanism.
- Restrict registered projects to directories the operator is willing to expose to the application. Set `PR0_WORKSPACE_ROOT` when a narrower registration boundary is needed.
- Provide provider credentials only through the server environment. Do not put credentials in workspace memory, prompts, model-generated file content, or source control.
- Review proposed filesystem changes and terminal commands before approval. Model-requested writes are limited to validated workspace files, reject common sensitive paths and credential-like values, and expose only a bounded text preview.
- Back up SQLite data and Git repositories using normal operator procedures. Database recovery marks interrupted tasks failed; it does not resume model execution.

## Known release limitations

- No API authentication, multi-user authorization, or hosted deployment boundary is implemented.
- Real OpenAI, Anthropic, Gemini, and Ollama connectivity has not been verified without operator-supplied credentials/services.
- Browser/research support is user-initiated and constrained to validated public HTTPS retrieval; arbitrary-site compatibility is not established.
- Successful subprocess execution and server binding must be checked on the target host if the environment restricts child processes or local sockets.
- `node:sqlite` is an experimental Node.js feature in the tested runtime.

Record the exact Node.js version, commands run, outcomes, and any target-host limitations with each release candidate. Do not describe a check as passed unless it was run against that candidate.