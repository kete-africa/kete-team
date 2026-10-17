# Leave

Asked with its kind and dates; its working days counted (`src/lib/days.ts`). After the gesture,
`route.ts` asks the center's circuit for `leave`, or decides that it is decided here (no circuit,
no center). The center's answer comes back at `/api/centre/decisions` as an id only; the app reads
the decision with its own token and applies it (`settle-leave`). Never decided by who asked; sent
back with a reason, it is corrected by who asked and decided again.

```mermaid
stateDiagram-v2
  [*] --> asked
  asked --> returned: sent back, with a reason
  returned --> asked: corrected by who asked
  asked --> approved
  asked --> refused
  asked --> cancelled: taken back
  returned --> cancelled
```

## The living model (spec 004)

A leave sent back is said to the center as its requester's to correct (`leaveHoldings`, kete-core
spec 114). A leave the center's circuit decides is already a holding there.
