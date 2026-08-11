# Wireframe — Order Cancellation

## Wide structure

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [HEADING cancellation-heading] Cancel order                               │
│ Return to order                                                            │
├──────────────────────────────────┬─────────────────────────────────────────┤
│ [REGION order-summary]           │ [REGION cancellation-form]              │
│                                  │                                         │
│ Order #A-10482                   │ Why are you cancelling?                 │
│ Paid · Not shipped               │ [FIELD reason-code ▼]                   │
│ Eligible for cancellation        │ [FIELD reason-detail]                   │
│                                  │                                         │
│ Refund estimate                  │ This action affects the entire order.   │
│ Original payment method          │ [ACTION submit-cancellation]            │
├──────────────────────────────────┴─────────────────────────────────────────┤
│ [REGION cancellation-result]                                               │
│ [MESSAGE validation-summary | conflict | pending receipt | completed]      │
└────────────────────────────────────────────────────────────────────────────┘
```

## Narrow structure

```text
┌────────────────────────────────┐
│ Cancel order                   │
│ Return to order                │
├────────────────────────────────┤
│ Order #A-10482                 │
│ Paid · Not shipped             │
│ Refund estimate                │
├────────────────────────────────┤
│ Why are you cancelling?       │
│ [reason-code ▼]                │
│ [reason-detail]                │
│ Entire-order consequence       │
│ [Cancel this order]            │
├────────────────────────────────┤
│ Result / recovery message      │
└────────────────────────────────┘
```

## Critical state overlays

### Conflict after shipment starts

```text
[STATUS Order state changed]
This order entered shipment while the page was open and can no longer be
cancelled here.
[ACTION refresh-order] [ACTION view-support-options]
```

### Provider timeout after acceptance

```text
[STATUS Cancellation processing]
Your request was accepted. Do not submit it again.
Reference: CN-2026-000184
[ACTION return-to-order]
```

### Validation error

```text
[ALERT validation-summary]
Select a cancellation reason.

[FIELD reason-code]  ← associated error
```

The layout intentionally keeps the order identity and full-order consequence visible before the destructive action.
