# Traceability Matrix — Order Cancellation

| UI ID | User intent | State/action | Interface operation | Domain rule | Failure behavior | Evidence |
|---|---|---|---|---|---|---|
| `order-summary` | Confirm the correct order and eligibility | Loading/ready/stale | Read model outside this example | Owner can view; shipment and payment state determine capability | Stable skeleton; permission-safe unavailable; refresh stale data | Read authorization + capability integration |
| `reason-code` | Explain cancellation reason | Validation | `requestOrderCancellation` | Reason required and allowed | Preserve input; field error and summary focus | Schema + interaction + E2E |
| `submit-cancellation` | Cancel the order once | Submitting | `requestOrderCancellation` | Owner only; paid and unshipped; one protected transition | Disable duplicate action; conflict refresh; pending receipt on timeout | Authorization + concurrency + idempotency + provider timeout |
| `cancellation-result` | Understand durable outcome | Success/system error | `requestOrderCancellation` receipt | Accepted operation remains reconcilable | Announce completed, pending, or support outcome with trace-safe reference | Accessibility + integration + reconciliation E2E |

## Required adversarial scenarios

1. Two concurrent requests with different idempotency keys.
2. Retry with the same key after the client times out.
3. Shipment starts after screen load but before submission.
4. Provider completes cancellation after the local request timed out.
5. Customer attempts cancellation for another customer's order identifier.
6. Screen-reader and keyboard completion through validation error and pending result.
