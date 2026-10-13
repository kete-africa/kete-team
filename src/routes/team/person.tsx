import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  PageHeader,
  Panel,
  SelectField,
  Tag,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPersonCard, grantAuthorisation } from '@/features/people/functions';
import { sayError } from '@/lib/errors';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/equipe/personnes/$userId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchPersonCard({ data: { userId: params.userId } }),
  component: PersonPage,
});

function PersonPage() {
  const { member, kinds, authorisations, assignments, may } = Route.useLoaderData();
  const router = useRouter();
  const day = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kindId, setKindId] = useState('');
  const [validFrom, setValidFrom] = useState(day);
  const [validUntil, setValidUntil] = useState('');
  const [proof, setProof] = useState('');

  if (!member) {
    return (
      <AppShell>
        <EmptyState title={m.person_not_found()} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        breadcrumbLabel={m.breadcrumb_label()}
        breadcrumbs={[{ label: m.people_title(), href: '/equipe/personnes' }, { label: member.name }]}
        title={member.name}
      />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>
        <Panel title={m.authorisations_title()}>
          <div className="flex flex-col gap-4">
            <DataTable
              caption={m.authorisations_title()}
              rows={authorisations}
              rowKey={(one) => one.authorisationId}
              empty={<p className="text-fg-muted">{m.authorisations_none()}</p>}
              columns={[
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
                { key: 'proof', label: m.authorisation_proof(), render: (one) => one.proof ?? '—' },
              ]}
            />
            {may.manage && (
              <form
                className="grid items-end gap-3 sm:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError(null);
                  void grantAuthorisation({
                    data: {
                      userId: member.userId,
                      kindId,
                      validFrom,
                      ...(validUntil ? { validUntil } : {}),
                      ...(proof.trim() ? { proof: proof.trim() } : {}),
                    },
                  })
                    .then(async (outcome) => {
                      if (!outcome.ok) return setError(sayError(outcome.code, outcome.facts));
                      setProof('');
                      await router.invalidate();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <SelectField
                  label={m.authorisation_kind()}
                  value={kindId}
                  required
                  options={[
                    { value: '', label: m.kind_choose() },
                    ...kinds.map((kind) => ({ value: kind.kindId, label: kind.name })),
                  ]}
                  onChange={(event) => setKindId(event.target.value)}
                />
                <TextField
                  label={m.authorisation_from()}
                  type="date"
                  value={validFrom}
                  required
                  onChange={(event) => setValidFrom(event.target.value)}
                />
                <TextField
                  label={m.authorisation_until()}
                  hint={m.authorisation_until_hint()}
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
                <TextField
                  label={m.authorisation_proof()}
                  value={proof}
                  maxLength={200}
                  onChange={(event) => setProof(event.target.value)}
                />
                <Button type="submit" disabled={busy || !kindId}>
                  {m.authorisation_grant()}
                </Button>
              </form>
            )}
          </div>
        </Panel>
        <Panel title={m.assignments_title()}>
          <DataTable
            caption={m.assignments_title()}
            rows={assignments}
            rowKey={(one) => one.assignmentId}
            empty={<p className="text-fg-muted">{m.assignments_none()}</p>}
            columns={[
              { key: 'project', label: m.project_label(), render: (one) => one.projectName },
              { key: 'role', label: m.assignment_role(), render: (one) => one.role ?? '—' },
              {
                key: 'dates',
                label: m.leave_dates(),
                render: (one) => `${one.startsOn} → ${one.endsOn}`,
              },
            ]}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
