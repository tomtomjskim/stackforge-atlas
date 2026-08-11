# Wireframes and Screen Contracts

## A wireframe is not enough

A static layout shows placement but hides behavior. StackForge Atlas treats a wireframe as the visual portion of a **screen contract**: a structured agreement about purpose, hierarchy, actions, states, permissions, data, accessibility, and responsive behavior.

## Fidelity levels

### Level 1 — Flow sketch

Use to validate navigation, sequence, decisions, and scope. Do not debate typography or component details.

### Level 2 — Structural wireframe

Use to validate information hierarchy, region priority, action placement, content density, and responsive reflow.

### Level 3 — Stateful interface specification

Use before implementation for medium- and high-risk surfaces. It pairs the wireframe with a machine-readable screen contract and backend interface references.

A polished mockup without Level 3 state coverage is still incomplete for implementation.

## Required screen-contract content

- screen identity, route or host context, and user purpose;
- permitted actors and authorization assumptions;
- entry points, exits, and return behavior;
- ordered layout regions and responsive transformations;
- primary, secondary, destructive, and bulk actions;
- data requirements and source operations;
- validation ownership and field-level messages;
- full state matrix;
- focus order, keyboard behavior, announcements, and semantic structure;
- telemetry needed to evaluate the outcome, not indiscriminate event capture;
- linked domain rules, interface operations, and acceptance tests.

## State matrix

Consider each state deliberately. Marking a state `not-applicable` requires a reason.

| State | Design questions |
|---|---|
| Initial | What appears before any input or request? |
| Loading | Is layout stable, cancellable, and understandable? |
| Ready | What is the main task and default focus? |
| Empty | Is the absence expected, and what action is useful? |
| Partial | Can useful data render when one dependency fails? |
| Stale | How is outdated data identified and refreshed? |
| Validation error | Which layer owns the rule and where is the message announced? |
| System error | Can the user retry safely, preserve input, or recover elsewhere? |
| Forbidden | Is the action hidden, disabled, or explained without leaking sensitive facts? |
| Conflict | What happens when data changed after the screen loaded? |
| Offline | Can the task be queued, saved locally, or clearly blocked? |
| Submitting | Are duplicate actions prevented without trapping the user? |
| Success | What changed, what remains, and where does focus move? |

## Annotation format

A wireframe region should use stable identifiers that also appear in the screen contract and traceability matrix.

```text
[REGION order-summary]
  [FIELD order-number] [STATUS payment-status]

[REGION cancellation-form]
  [FIELD reason-code]
  [FIELD reason-detail]
  [ACTION submit-cancellation]
  [ACTION return-to-order]

[REGION feedback]
  [MESSAGE validation-summary]
  [MESSAGE operation-result]
```

Do not annotate implementation-specific component names before the semantic need is agreed. `ACTION submit-cancellation` is more durable than `RedButtonV2`.

## Responsive and accessibility review

The contract must state how reading order, focus order, actions, tables, filters, and overlays change at constrained widths. A desktop wireframe scaled down is not a mobile design.

At minimum verify:

- semantic headings and landmarks;
- keyboard reachability and visible focus;
- logical focus return after dialogs or updates;
- errors associated with fields and summarized when useful;
- status updates announced without stealing focus;
- controls remain understandable at zoom and reflow;
- target sizes and alternatives for precision gestures;
- destructive and irreversible actions are distinguishable by more than color.

## Handoff rule

Implementation starts when the wireframe, screen contract, interface contract, and traceability matrix tell the same story. Any mismatch is a design defect, not an implementation detail to guess.
