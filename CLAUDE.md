# Kete Team — project context

> The single place where this app's context lives. `AGENTS.md` points here.

## What this app is

People at work, behind Kete Enterprise: the roster, the **authorisations that expire**, what each
project requires, **assignments**, **leave**, and **time by project in one answer a week** — with
the month's elements for the pay. One of the four generic apps of the doctrine (D-048). It
requires the center for what it does not own: projects (D-047) and the circuits that decide a
leave.

What it never does: compute a pay slip, hold a project of its own, send someone to a site she is
not authorised to work on.

Product names are in English (Kete Team, Kete Finance, Kete Enterprise); the words on its screens
are in the language of who reads them.

## Read before any action

1. The Kete doctrine (`kete-africa/kete`): `docs/PRINCIPES.md`, `docs/CONCEPTION.md`,
   `docs/ARCHITECTURE_APP.md`, `docs/DECISIONS.md` (D-047, D-048 for this app).
2. `docs/ROADMAP.md` — the steps of this app, what is built and what is proven.
3. `docs/ARCHITECTURE.md` and `docs/decisions/` — this app's architecture and decisions.
4. Each feature's `README.md` (`src/features/*/README.md`) and its spec (`specs/`).

## Layout

```
kete.json          the manifest (contract manifest.v1): product, version, events, and the
                   identity card (owner, data, AI, criticality), kept true as the app changes
src/routes.ts      every address, once: English files, French addresses
src/features/      one folder per feature
  people/          the roster, authorisations, what a project requires, assignments
  leave/           leave: asked, decided by the center's circuit or here, applied
  time/            the week's answer, the month's elements, the time data set
src/lib/days.ts    the app's one calendar: working days, the Monday of a week
src/platform/      the wiring, no business rule: sign-in, database, rights, registry, MCP,
                   events, jobs, what the center is asked after a gesture (sync.ts), whose
                   request it is while a gesture runs (person.ts)
src/worker/        the worker role: e-mails, events (pg-boss)
db/migrations.ts   every table with its row-level security, in order
db/demo/           the demonstration's data, written through the app's own gestures
messages/          fr.json, en.json: no hard-coded string
specs/             one folder per step: what changes, what stays for later, the proof
tests/             every surface under the same rules
```

## Rules

- An assignment is refused when the person does not hold, for the whole period, every
  authorisation the project requires — whoever asks, a person or an agent. The refusal names what
  is missing and until when what she holds is valid.
- An assignment is never made longer: a longer one is a new assignment, checked again.
- A leave is never decided by who asked it. The center's circuit decides when the organization
  has one; otherwise who holds `team:approve`.
- Days are counted in one place (`src/lib/days.ts`); a week's answer is counted in half-days.
- A person reads her own things; reading everyone's is a permission.
- Every gesture is a named command (@kete/commands), and every capability declares its autonomy
  (@kete/capabilities): an agent prepares, a person decides.
- Every table carries `organization_id` and its RLS policy in the same migration.
- No vendor name in a feature's domain or application layer: ports and adapters.
- No hard-coded user-visible string; no secret in a file, a message or a commit.
- A behavior change ships with its documentation and its diagram.

## Branches

```
main       production — the human gesture only
dev        integration
NNN-slug   one step, branched from dev, with its spec in specs/NNN-slug
```
