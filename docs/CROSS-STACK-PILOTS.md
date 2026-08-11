# Cross-stack Pilots

Cross-stack pilots test whether Atlas contracts survive implementation in different languages and operational shapes. They are not syntax translations and they do not rank languages by popularity.

## Pilot protocol

Each pilot must provide:

1. a shared product, screen, and interface contract;
2. a runnable implementation;
3. a project map describing boundaries and limitations;
4. an implementation manifest mapping operations to handlers and evidence;
5. an evaluation case with stable acceptance scenarios;
6. stack-native type, test, and verification commands;
7. an adversarial statement of what the pilot does not prove.

## Comparison rule

The same scenario should be compared across stacks without forcing identical internal architecture.

```text
Keep constant
- user outcome
- operation IDs and transport semantics
- domain invariants
- security boundary
- failure and recovery expectations
- evaluation scenarios

Allow to vary
- framework
- module organization
- transaction adapter
- test tools
- runtime lifecycle
- deployment packaging
```

## Evidence levels

| Level | Meaning |
|---|---|
| Contract | Structured artifacts agree and references resolve. |
| Runnable | The implementation starts and exposes the declared boundary. |
| Verified | Automated tests exercise domain and interface behavior. |
| Operational | Persistence, recovery, observability, deployment, and rollback are exercised. |
| Comparative | Repeated runs across harness modes or stacks produce measured results. |

A pilot must not claim a higher level because a lower-level validator passed.

## First sequence

1. TypeScript / Node.js greenfield runnable pilot
2. Python port of the same contract
3. PHP port with explicit legacy and modern runtime variants
4. Relational persistence adapters for PostgreSQL and MySQL
5. Existing-codebase maintenance task using the same evaluation case

Rules should be promoted into `core/` only after a failure repeats across more than one stack or project shape.
