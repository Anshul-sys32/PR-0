# Security

The server binds to `127.0.0.1` by default and permits the configured frontend origin only. Request bodies are size-limited and parsed with Zod at API boundaries. Registered projects can optionally be restricted beneath `PR0_WORKSPACE_ROOT`; registration resolves symlinks before checking the boundary and requires an existing directory.

Filesystem access supports explicit UTF-8 reads and approval-gated writes. Absolute paths, lexical traversal, symlink escapes, symbolic-link overwrite targets, directories, and binary reads are rejected. Writes must target an existing, resolved directory within the registered workspace and default to no-overwrite behavior. Supervised and ask-first writes become persisted pending operations; approving the related request executes it server-side.

Terminal commands use direct process spawning with `shell: false`; the initial allowlist is `node`, `npm`, `npx`, and `git`. Commands are workspace-scoped, receive no stdin, have bounded output, use a configurable timeout, and require approval in supervised or ask-first mode. Active child processes are terminated during server shutdown.

Model output, repository files, terminal output, and web pages must be treated as untrusted data. Tool permissions, rather than model instructions, are the authority boundary.

The model tool loop exposes only registered tools, validates inputs before dispatch, caps iterations, and truncates results. Model-readable filesystem access rejects common secret files such as `.env*`, SSH keys, credential files, and private key files. Provider API keys are accepted only by the server process environment and are not persisted or returned through provider status endpoints.
