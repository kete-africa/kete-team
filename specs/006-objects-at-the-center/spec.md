# Spec 006 — Leaves and authorisations in the center's index

Kete-core spec 142, Kete Enterprise spec 100; doctrine D-062, R1 and R15.

## Requirements

- **FR-001 — Declared.** The manifest declares `leave` (asked, returned, approved; taken, refused,
  cancelled close it) and `authorisation` (valid, ending within a month; expired closes it), on the
  person axis.
- **FR-002 — Said.** With its holdings, the app says each leave in progress or to come, each
  authorisation valid, and those that ended in the last month: title, state, person, where it
  opens. Their data stays here.

## Proof

`tests/team.test.ts`: both kinds pass their contract; an authorisation ending in five days is said
« ending » for its holder; every object in the shape of `object.v1` with a declared state.
