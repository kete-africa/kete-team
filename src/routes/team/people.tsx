import { Button, DataTable, EmptyState, ErrorNote, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { addMember, fetchRoster, nameKind } from '@/features/people/functions';
import { sayError } from '@/lib/errors';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/equipe/personnes')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRoster(),
  component: PeoplePage,
});

function PeoplePage() {
  const { members, kinds, expiring, may } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');

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
  const soon = new Set(expiring.map((one) => one.userId));

  return (
    <AppShell>
      <PageHeader title={m.people_title()} description={m.people_intro()} />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>
        <DataTable
          caption={m.people_title()}
          rows={members}
          rowKey={(member) => member.userId}
          rowHref={(member) => `/equipe/personnes/${member.userId}`}
          empty={<EmptyState title={m.people_empty()}>{m.people_empty_body()}</EmptyState>}
          columns={[
            { key: 'name', label: m.person_label(), render: (member) => member.name },
            { key: 'joined', label: m.person_joined(), render: (member) => member.joinedOn ?? '—' },
            {
              key: 'state',
              label: m.doc_status(),
              render: (member) =>
                soon.has(member.userId) ? (
                  <Tag tone="verify">{m.person_expiring()}</Tag>
                ) : (
                  <Tag tone="neutral">{member.active ? m.person_active() : m.person_gone()}</Tag>
                ),
            },
          ]}
        />

        {may.manage && (
          <>
            <Panel title={m.person_add_title()}>
              <form
                className="grid items-end gap-3 sm:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(
                    () => addMember({ data: { userId: userId.trim(), name: name.trim() } }),
                    () => {
                      setUserId('');
                      setName('');
                    },
                  );
                }}
              >
                <TextField
                  label={m.person_label()}
                  value={name}
                  required
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                <TextField
                  label={m.person_account()}
                  hint={m.person_account_hint()}
                  value={userId}
                  required
                  maxLength={64}
                  onChange={(event) => setUserId(event.target.value)}
                />
                <Button type="submit" disabled={busy || !name.trim() || !userId.trim()}>
                  {m.person_add()}
                </Button>
              </form>
            </Panel>
            <Panel title={m.kinds_title()}>
              <div className="flex flex-col gap-3">
                <p className="text-fg-muted">
                  {kinds.length > 0 ? kinds.map((one) => one.name).join(' · ') : m.kinds_none()}
                </p>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(
                      () => nameKind({ data: { name: kind.trim() } }),
                      () => setKind(''),
                    );
                  }}
                >
                  <TextField
                    label={m.kind_name()}
                    hint={m.kind_name_hint()}
                    value={kind}
                    required
                    maxLength={120}
                    onChange={(event) => setKind(event.target.value)}
                  />
                  <Button type="submit" variant="secondary" disabled={busy || !kind.trim()}>
                    {m.kind_add()}
                  </Button>
                </form>
              </div>
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}
