# Feature Slice Kit

Copy this directory for a medium- or high-risk product task. Rename the folder to the feature identifier and replace every placeholder.

## Files

| File | Purpose |
|---|---|
| `feature.yaml` | Outcome, scope, actors, risks, surfaces, interfaces, and gates |
| `user-flow.md` | Normal, alternate, and recovery paths |
| `wireframe.md` | Annotated wide, narrow, and stateful screen structures |
| `screen-contract.yaml` | Stateful surface contract, including read and status dependencies |
| `design-tokens.json` | Example DTCG-format semantic token additions |
| `design-system-decision.md` | Reuse, addition, exception, adoption, and deprecation decisions |
| `openapi.yaml` | Read model, command, error, and durable operation-status contracts |
| `traceability-matrix.md` | UI-to-domain-to-interface-to-test mapping |
| `implementation-plan.md` | Bounded build, migration, rollout, and rollback plan |
| `review-report.md` | Adversarial findings and verification evidence |

## Recommended order

```text
feature.yaml
→ user-flow.md
→ wireframe.md + screen-contract.yaml
→ design-system decision
→ OpenAPI/AsyncAPI contract
→ traceability matrix
→ implementation plan
→ build and verify
→ review report
```

Not every task requires new tokens or a new endpoint. Keep the file and state that the feature reuses existing contracts; absence of change is still a decision.

A command returning `202 Accepted` is incomplete unless the UI has a durable completion path: an operation-status query, a push subscription, or another explicit terminal-state mechanism. Do not represent an accepted but unresolved operation as generic success.

## Validation

The repository validator checks the YAML and JSON files against the Atlas schemas, performs basic OpenAPI and token checks, and verifies that structured screen dependencies and traceability operation IDs exist in the declared interface contracts.

```bash
python scripts/validate_atlas.py
```
