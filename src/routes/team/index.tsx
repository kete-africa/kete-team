import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  InfoNote,
  PageHeader,
  Panel,
  SelectField,
  Tag,
  TextField,
  type TagTone,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import type { Leave } from '@/features/leave';
import {
  askLeave,
  cancelLeave,
  decideLeave,
  fetchMine,
  sayWeek,
} from '@/features/time/functions';
import { leaveKinds, workingDays, type LeaveKind } from '@/lib/days';
import { sayError } from '@/lib/errors';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/equipe')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchMine(),
  component: MinePage,
});

const kindLabel = (kind: LeaveKind) =>
  ({
    annual: m.leave_annual,
    sick: m.leave_sick,
    unpaid: m.leave_unpaid,
    other: m.leave_other,
  })[kind]();

const tones: Record<Leave['status'], TagTone> = {
  asked: 'info',
  returned: 'verify',
  approved: 'validated',
  refused: 'error',
  cancelled: 'neutral',
};
const statusLabel = (status: Leave['status']) =>
  ({
    asked: m.leave_asked,
    returned: m.leave_returned,
    approved: m.leave_approved,
    refused: m.leave_refused,
    cancelled: m.leave_cancelled,
  })[status]();

function MinePage() {
  const mine = Route.useLoaderData();
  const router = useRouter();
  const day = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries((mine.week.entries ?? []).map((e) => [e.projectId, String(e.days)])),
  );
  const [kind, setKind] = useState<LeaveKind>('annual');
  const [startsOn, setStartsOn] = useState(day);
  const [endsOn, setEndsOn] = useState(day);
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState<Record<string, string>>({});

  const run = (
    work: () => Promise<
      { ok: true } | { ok: false; code: string; facts: Record<string, string | number> }
    >,
    then?: () => void,
  ) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (outcome) => {
        if (!outcome.ok) return setError(sayError(outcome.code, outcome.facts));
        then?.();
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };

  const entries = mine.week.projects.map((project) => ({
    projectId: project.projectId,
    days: Number((days[project.projectId] ?? '0').replace(',', '.')),
  }));
  const weekOk = entries.every(
    (entry) => Number.isFinite(entry.days) && entry.days >= 0 && Number.isInteger(entry.days * 2),
  );
  const counted = workingDays(startsOn, endsOn);

  return (
    <AppShell>
      <PageHeader title={m.mine_title({ name: mine.me.name })} description={m.mine_intro()} />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>

        <Panel title={m.week_title({ monday: mine.week.weekStart })}>
          {mine.week.projects.length === 0 ? (
            <p className="text-fg-muted">{m.week_no_project()}</p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!weekOk) return;
                run(() => sayWeek({ data: { weekStart: mine.week.weekStart, entries } }));
              }}
            >
              <p className="text-fg-muted">
                {mine.week.entries ? m.week_said({ total: String(mine.week.total) }) : m.week_ask()}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {mine.week.projects.map((project) => (
                  <TextField
                    key={project.projectId}
                    label={project.name}
                    hint={m.week_days_hint()}
                    inputMode="decimal"
                    value={days[project.projectId] ?? ''}
                    onChange={(event) =>
                      setDays({ ...days, [project.projectId]: event.target.value })
                    }
                  />
                ))}
              </div>
              <div>
                <Button type="submit" disabled={busy || !weekOk}>
                  {m.week_say()}
                </Button>
              </div>
            </form>
          )}
        </Panel>

        {mine.toDecide.length > 0 && (
          <Panel title={m.leave_to_decide()}>
            <div className="flex flex-col gap-4">
              {mine.toDecide.map((leave) => (
                <div key={leave.leaveId} className="flex flex-col gap-2 border-b border-line pb-4">
                  <p>
                    {m.leave_line({
                      number: leave.number,
                      name: leave.requester.name,
                      kind: kindLabel(leave.kind),
                      from: leave.startsOn,
                      to: leave.endsOn,
                      days: String(leave.days),
                    })}
                  </p>
                  {leave.reason && <p className="text-fg-muted">{leave.reason}</p>}
                  <div className="flex flex-wrap items-end gap-2">
                    <TextField
                      label={m.leave_decide_reason()}
                      value={why[leave.leaveId] ?? ''}
                      maxLength={1000}
                      onChange={(event) => setWhy({ ...why, [leave.leaveId]: event.target.value })}
                    />
                    {(['approve', 'return', 'refuse'] as const).map((decision) => (
                      <Button
                        key={decision}
                        variant={decision === 'approve' ? 'primary' : 'secondary'}
                        disabled={
                          busy || (decision === 'return' && !(why[leave.leaveId] ?? '').trim())
                        }
                        onClick={() =>
                          run(() =>
                            decideLeave({
                              data: {
                                leaveId: leave.leaveId,
                                decision,
                                ...((why[leave.leaveId] ?? '').trim()
                                  ? { reason: (why[leave.leaveId] ?? '').trim() }
                                  : {}),
                              },
                            }),
                          )
                        }
                      >
                        {{
                          approve: m.decide_approve,
                          return: m.decide_return,
                          refuse: m.decide_refuse,
                        }[decision]()}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title={m.leave_mine()}>
          <div className="flex flex-col gap-4">
            <DataTable
              caption={m.leave_mine()}
              rows={mine.leaves}
              rowKey={(leave) => leave.leaveId}
              empty={<p className="text-fg-muted">{m.leave_none()}</p>}
              columns={[
                { key: 'number', label: m.doc_number(), render: (leave) => leave.number },
                { key: 'kind', label: m.leave_kind(), render: (leave) => kindLabel(leave.kind) },
                {
                  key: 'dates',
                  label: m.leave_dates(),
                  render: (leave) => `${leave.startsOn} → ${leave.endsOn}`,
                },
                { key: 'days', label: m.leave_days(), align: 'end', render: (leave) => leave.days },
                {
                  key: 'status',
                  label: m.doc_status(),
                  render: (leave) => (
                    <span className="flex flex-wrap items-center gap-2">
                      <Tag tone={tones[leave.status]}>{statusLabel(leave.status)}</Tag>
                      {leave.decided?.reason && (
                        <span className="text-body-sm text-fg-muted">{leave.decided.reason}</span>
                      )}
                      {(leave.status === 'asked' || leave.status === 'returned') && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => run(() => cancelLeave({ data: { leaveId: leave.leaveId } }))}
                        >
                          {m.leave_cancel()}
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            <form
              className="grid items-end gap-3 sm:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () =>
                    askLeave({
                      data: {
                        kind,
                        startsOn,
                        endsOn,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      },
                    }),
                  () => setReason(''),
                );
              }}
            >
              <SelectField
                label={m.leave_kind()}
                value={kind}
                options={leaveKinds.map((value) => ({ value, label: kindLabel(value) }))}
                onChange={(event) => setKind(event.target.value as LeaveKind)}
              />
              <TextField
                label={m.leave_from()}
                type="date"
                value={startsOn}
                required
                onChange={(event) => setStartsOn(event.target.value)}
              />
              <TextField
                label={m.leave_to()}
                type="date"
                value={endsOn}
                required
                hint={m.leave_counted({ days: String(counted) })}
                onChange={(event) => setEndsOn(event.target.value)}
              />
              <TextField
                label={m.leave_reason()}
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button type="submit" disabled={busy || counted === 0}>
                {m.leave_ask()}
              </Button>
            </form>
            <InfoNote>{mine.connected ? m.leave_route_center() : m.leave_route_here()}</InfoNote>
          </div>
        </Panel>

        <Panel title={mine.may.read ? m.expiring_all() : m.authorisations_mine()}>
          <DataTable
            caption={m.authorisations_mine()}
            rows={mine.may.read ? mine.expiring : mine.authorisations}
            rowKey={(one) => one.authorisationId}
            empty={
              <EmptyState
                title={mine.may.read ? m.expiring_none() : m.authorisations_none()}
              />
            }
            columns={[
              ...(mine.may.read
                ? [
                    {
                      key: 'who',
                      label: m.person_label(),
                      render: (one: (typeof mine.expiring)[number]) => one.memberName,
                    },
                  ]
                : []),
              { key: 'kind', label: m.authorisation_kind(), render: (one) => one.kindName },
              { key: 'from', label: m.authorisation_from(), render: (one) => one.validFrom },
              {
                key: 'until',
                label: m.authorisation_until(),
                render: (one) =>
                  one.validUntil === null ? (
                    m.authorisation_never()
                  ) : one.validUntil < day ? (
                    <Tag tone="error">{m.authorisation_expired({ day: one.validUntil })}</Tag>
                  ) : (
                    one.validUntil
                  ),
              },
            ]}
          />
        </Panel>

        {mine.away.length > 0 && (
          <Panel title={m.away_title()}>
            <DataTable
              caption={m.away_title()}
              rows={mine.away}
              rowKey={(leave) => leave.leaveId}
              columns={[
                { key: 'who', label: m.person_label(), render: (leave) => leave.requester.name },
                { key: 'kind', label: m.leave_kind(), render: (leave) => kindLabel(leave.kind) },
                {
                  key: 'dates',
                  label: m.leave_dates(),
                  render: (leave) => `${leave.startsOn} → ${leave.endsOn}`,
                },
                { key: 'days', label: m.leave_days(), align: 'end', render: (leave) => leave.days },
              ]}
            />
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
