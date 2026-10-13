import {
  Button,
  CheckField,
  DataTable,
  EmptyState,
  ErrorNote,
  InfoNote,
  PageHeader,
  Panel,
  SelectField,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  assignPerson,
  fetchAssignments,
  requireForProject,
} from '@/features/people/functions';
import { sayError } from '@/lib/errors';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/equipe/affectations')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchAssignments(),
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const { assignments, projects, members, kinds, may, connected } = Route.useLoaderData();
  const router = useRouter();
  const day = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [startsOn, setStartsOn] = useState(day);
  const [endsOn, setEndsOn] = useState(day);
  const [role, setRole] = useState('');
  const [requiring, setRequiring] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);

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
  const project = projects.find((one) => one.projectId === projectId);

  return (
    <AppShell>
      <PageHeader title={m.assignments_title()} description={m.assignments_intro()} />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>
        {!connected && projects.length === 0 && <InfoNote>{m.assignments_alone()}</InfoNote>}

        {may.manage && (
          <Panel title={m.assign_title()}>
            <form
              className="grid items-end gap-3 sm:grid-cols-6"
              onSubmit={(event) => {
                event.preventDefault();
                run(() =>
                  assignPerson({
                    data: {
                      userId,
                      projectId,
                      startsOn,
                      endsOn,
                      ...(role.trim() ? { role: role.trim() } : {}),
                    },
                  }),
                );
              }}
            >
              <SelectField
                label={m.person_label()}
                value={userId}
                required
                options={[
                  { value: '', label: m.person_choose() },
                  ...members.map((member) => ({ value: member.userId, label: member.name })),
                ]}
                onChange={(event) => setUserId(event.target.value)}
              />
              <SelectField
                label={m.project_label()}
                value={projectId}
                required
                {...(project && project.kinds.length > 0
                  ? {
                      hint: m.project_requires({
                        kinds: project.kinds.map((kind) => kind.name).join(', '),
                      }),
                    }
                  : {})}
                options={[
                  { value: '', label: m.project_choose() },
                  ...projects.map((one) => ({ value: one.projectId, label: one.name })),
                ]}
                onChange={(event) => setProjectId(event.target.value)}
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
                onChange={(event) => setEndsOn(event.target.value)}
              />
              <TextField
                label={m.assignment_role()}
                value={role}
                maxLength={120}
                onChange={(event) => setRole(event.target.value)}
              />
              <Button type="submit" disabled={busy || !userId || !projectId}>
                {m.assign()}
              </Button>
            </form>
          </Panel>
        )}

        <DataTable
          caption={m.assignments_title()}
          rows={assignments}
          rowKey={(one) => one.assignmentId}
          empty={<EmptyState title={m.assignments_none()} />}
          columns={[
            { key: 'who', label: m.person_label(), render: (one) => one.memberName },
            { key: 'project', label: m.project_label(), render: (one) => one.projectName },
            { key: 'role', label: m.assignment_role(), render: (one) => one.role ?? '—' },
            {
              key: 'dates',
              label: m.leave_dates(),
              render: (one) => `${one.startsOn} → ${one.endsOn}`,
            },
          ]}
        />

        <Panel title={m.requirements_title()}>
          <div className="flex flex-col gap-4">
            <p className="text-fg-muted">{m.requirements_intro()}</p>
            <DataTable
              caption={m.requirements_title()}
              rows={projects}
              rowKey={(one) => one.projectId}
              empty={<p className="text-fg-muted">{m.requirements_none()}</p>}
              columns={[
                { key: 'project', label: m.project_label(), render: (one) => one.name },
                {
                  key: 'kinds',
                  label: m.requirements_kinds(),
                  render: (one) =>
                    one.kinds.length > 0
                      ? one.kinds.map((kind) => kind.name).join(', ')
                      : m.requirements_nothing(),
                },
              ]}
            />
            {may.manage && kinds.length > 0 && (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(() => requireForProject({ data: { projectId: requiring, kindIds: ticked } }));
                }}
              >
                <SelectField
                  label={m.project_label()}
                  value={requiring}
                  required
                  options={[
                    { value: '', label: m.project_choose() },
                    ...projects.map((one) => ({ value: one.projectId, label: one.name })),
                  ]}
                  onChange={(event) => {
                    setRequiring(event.target.value);
                    setTicked(
                      projects
                        .find((one) => one.projectId === event.target.value)
                        ?.kinds.map((kind) => kind.kindId) ?? [],
                    );
                  }}
                />
                <div className="grid gap-1 sm:grid-cols-2">
                  {kinds.map((kind) => (
                    <CheckField
                      key={kind.kindId}
                      label={kind.name}
                      checked={ticked.includes(kind.kindId)}
                      onChange={(checked) =>
                        setTicked(
                          checked
                            ? [...ticked, kind.kindId]
                            : ticked.filter((one) => one !== kind.kindId),
                        )
                      }
                    />
                  ))}
                </div>
                <div>
                  <Button type="submit" variant="secondary" disabled={busy || !requiring}>
                    {m.requirements_save()}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
