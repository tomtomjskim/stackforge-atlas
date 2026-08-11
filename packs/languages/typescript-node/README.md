# TypeScript / Node.js Profile

This profile is **pilot**, not a universal default. It records what the first runnable Atlas implementation actually exercised and separates that evidence from assumptions about the wider ecosystem.

## Current baseline

- Node.js 24 LTS
- TypeScript 6.0
- npm with exact direct development dependencies in the pilot
- strict type checking
- `node:test` for dependency-light domain and HTTP tests

Node.js 26 is Current as of the review date, while Node.js 24 is an LTS line. The pilot chooses the LTS line because production-oriented examples should not default to a Current release without a concrete need.

TypeScript 6.0 is a transition release preparing for the native TypeScript 7 compiler. New projects should make module resolution, `rootDir`, `types`, and strictness explicit rather than depending on historical defaults.

## Proven by the pilot

- Native Node HTTP APIs are sufficient to demonstrate contract alignment without framework-specific abstractions.
- A synchronous in-process transition can prove idempotency semantics, but it cannot prove multi-process or database atomicity.
- Type checking and runtime tests catch different defect classes and must both run.
- A `202 Accepted` command needs a durable status resource and UI pending state.
- The browser must consume authoritative capability and version data instead of duplicating ownership and eligibility rules.

## Not yet proven

- Framework choice or comparative productivity
- Persistent relational implementation
- Worker and queue topology
- Production authentication and authorization middleware
- Load, memory, startup, or deployment behavior
- Dependency supply-chain and lockfile policy across a larger application

The profile should move from `pilot` to `recommended` only after at least one maintained production-shaped project and one legacy-maintenance task pass the same evaluation model.
