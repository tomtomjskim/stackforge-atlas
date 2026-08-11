# Design-System Contract Templates

Use these templates when a feature requires a new reusable component or pattern. A feature-specific composition should remain in its screen contract instead of being promoted prematurely.

A component is ready for proposal when:

- it solves repeated semantic behavior rather than shared appearance alone;
- its states and interaction can be defined independently of one screen's data model;
- accessibility and responsive behavior are part of the contract;
- known consumers and migration implications are visible;
- tests can verify the contract without relying only on snapshots.
