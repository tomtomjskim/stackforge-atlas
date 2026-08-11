# Traceability Matrix — Order Cancellation

| UI ID | User intent | State/action | Interface operation | Domain rule | Failure behavior | Evidence |
|---|---|---|---|---|---|---|
| `order-summary` | Confirm the correct order and eligibility | Loading/ready/stale | `getOrderCancellationContext` | Owner can view; shipment and payment state determine capability | Stable skeleton; permission-safe unavailable; refresh stale data | Read authorization + capability integration |
| `reason-code` | Explain cancellation reason | Ready/validation | `getOrderCancellationContext` + `requestOrderCancellation` | Option is current; submitted reason is authoritative | Preserve input; field error and summary focus | Schema + interaction + E2E |
| `submit-cancellation` | Cancel the order once | Submitting | `requestOrderCancellation` | Owner only; paid and unshipped; one protected transition | Disable duplicate action; conflict refresh; durable pending receipt | Authorization + concurrency + idempotency + provider timeout |
| `cancellation-result` | Understand durable outcome | Pending/success/terminal error | `getOrderCancellation` | Accepted operation remains queryable and reconcilable | Bounded polling; announce completion or final failure with safe reference | Accessibility + status contract + reconciliation E2E |

## Required adversarial scenarios

1. Two concurrent requests with different idempotency keys.
2. Retry with the same key after the client times out.
3. Shipment starts after screen load but before submission.
4. Provider completes cancellation after the local request timed out.
5. Customer attempts cancellation for another customer's order identifier.
6. Accepted operation remains pending across navigation and page reload.
7. Terminal provider rejection is presented as a final failure, not an endless spinner.
8. Screen-reader and keyboard completion through validation error, pending, and final result.
