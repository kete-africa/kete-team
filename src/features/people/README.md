# The roster

Members, the kinds of authorisations tracked, what each person holds, what each project requires,
and assignments (spec 001).

- `domain/validity.ts` — whether what a person holds covers a period: authorisations that overlap
  or follow without a day between count as one; a day without any is not covered.
- `commands/people.ts` — `assign` refuses, naming the authorisation and until when it is valid,
  when the person is not covered for the whole period, and when she is on approved leave (asked
  of the leave feature through `useLeaveCheck`). `end-assignment` shortens, never lengthens.
- `infrastructure/people.table.ts` — five tables with their row-level security; `expiringWithin`
  says each person's latest authorisation of a kind, so one that was renewed is not said to
  expire.
