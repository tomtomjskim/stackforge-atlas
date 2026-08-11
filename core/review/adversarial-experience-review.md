# Adversarial Experience Review

## Review stance

Assume the feature is incomplete, misleading, unsafe, or hard to maintain until evidence shows otherwise. The purpose is not to produce criticism volume; it is to find concrete failure modes before users or operators do.

## Review perspectives

### The confused user

- Can the user tell what changed and what to do next?
- Are empty, delayed, and error states distinguishable?
- Does destructive language accurately describe scope and reversibility?
- Can input survive a recoverable failure?

### The constrained user

- Can the task be completed by keyboard and at zoom/reflow?
- Are focus and announcements predictable?
- Does meaning survive without color, hover, drag, or precise pointer movement?
- Are time limits, repeated entry, and authentication steps reasonable?

### The unauthorized actor

- Can client-side state expose or invoke behavior the actor cannot perform?
- Are object-level permissions enforced by the backend?
- Do errors reveal protected object facts, internal identifiers, secrets, or stack details?
- Can replay, duplicate submission, parameter tampering, or bulk abuse cause harm?

### The unreliable environment

- What happens under high latency, timeout, partial dependency failure, duplicate delivery, stale data, and offline transition?
- Are retries safe and bounded?
- Can the user distinguish accepted, pending, completed, and failed work?

### The concurrent actor

- What happens when another user, job, webhook, or device changes the same state?
- Is conflict detected before destructive side effects?
- Are idempotency and transaction boundaries explicit?

### The future maintainer

- Can the behavior be located from the project map and traceability matrix?
- Are component and API exceptions documented?
- Does the code preserve domain language or hide it behind framework abstractions?
- Can the change be rolled back or reconciled?

## Review procedure

1. Read the feature brief, screen contracts, interface contracts, and implementation diff independently.
2. Identify contradictions and unstated assumptions before running tests.
3. Create concrete reproduction scenarios for material risks.
4. Verify existing evidence rather than trusting its label.
5. Record findings with severity, confidence, evidence, impact, and recommended disposition.
6. Re-run affected evidence after repair.

## Finding levels

| Severity | Meaning |
|---|---|
| Blocker | Likely data loss, security breach, financial error, inaccessible critical path, or inability to recover |
| Major | Material user failure, contract break, race condition, or operational blind spot |
| Moderate | Bounded inconsistency or maintainability problem with a credible future cost |
| Minor | Local clarity or polish issue without material risk |

## Pass criteria

A review passes when:

- no blocker remains open;
- every major finding is fixed, explicitly accepted by an accountable owner, or removed from release scope;
- acceptance evidence was rerun after material repair;
- unresolved uncertainty and production monitoring are documented.

A review with no findings is valid only when it explains the scenarios considered and the evidence that defeated them.
