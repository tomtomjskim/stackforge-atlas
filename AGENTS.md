# Repository Operating Rules

These rules are intentionally small. Load detailed guidance only for the task in scope.

1. Read the task brief, the nearest relevant core guide, and any existing project map before changing files.
2. Inspect the current implementation before proposing a replacement. Do not infer unseen behavior.
3. Make the smallest coherent change that satisfies explicit acceptance criteria and preserves compatibility unless a breaking change is approved.
4. For product-facing work, keep user flow, screen states, design-system decisions, backend interfaces, and tests traceable as one feature slice.
5. Model loading, empty, error, forbidden, stale, offline, partial, and success states when they are materially possible; do not implement only the happy path.
6. Treat authentication, authorization, personal data, money, inventory, migrations, background jobs, and external integrations as high-risk surfaces.
7. Run the repository validation command and the task-specific tests. Report every skipped or failed check without disguising uncertainty.
8. Perform an adversarial review for medium- and high-risk changes. Findings require evidence, impact, and a disposition.
9. Update source maps, ADRs, contracts, or runbooks only when the underlying structure or operating behavior changed.
10. Completion reports must lead with evidence: what changed, what was verified, what remains uncertain, and how to roll back when relevant.
