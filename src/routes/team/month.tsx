import { DataTable, EmptyState, PageHeader, Tag, TextField } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { fetchMonth } from '@/features/time/functions';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export const Route = createFileRoute('/equipe/mois')({
  validateSearch: (search) =>
    z.object({ mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).parse(search),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ month: search.mois ?? thisMonth() }),
  loader: ({ deps }) => fetchMonth({ data: { month: deps.month } }),
  component: MonthPage,
});

function MonthPage() {
  const elements = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <AppShell>
      <PageHeader
        title={m.month_title({ month: elements.month })}
        description={m.month_intro()}
        actions={
          <TextField
            label={m.month_label()}
            type="month"
            value={elements.month}
            onChange={(event) =>
              void navigate({ to: '/equipe/mois', search: { mois: event.target.value } })
            }
          />
        }
      />
      <DataTable
        caption={m.month_title({ month: elements.month })}
        rows={elements.people}
        rowKey={(person) => person.userId}
        empty={<EmptyState title={m.people_empty()} />}
        columns={[
          { key: 'name', label: m.person_label(), render: (person) => person.name },
          {
            key: 'projects',
            label: m.month_by_project(),
            render: (person) =>
              person.projects.length > 0
                ? person.projects.map((p) => `${p.name} : ${p.days}`).join(' · ')
                : '—',
          },
          { key: 'worked', label: m.month_worked(), align: 'end', render: (person) => person.worked },
          {
            key: 'annual',
            label: m.leave_annual(),
            align: 'end',
            render: (person) => person.leave.annual,
          },
          { key: 'sick', label: m.leave_sick(), align: 'end', render: (person) => person.leave.sick },
          {
            key: 'unpaid',
            label: m.leave_unpaid(),
            align: 'end',
            render: (person) => person.leave.unpaid,
          },
          {
            key: 'missing',
            label: m.month_missing(),
            render: (person) =>
              person.weeksMissing > 0 ? (
                <Tag tone="verify">{m.month_weeks_missing({ count: String(person.weeksMissing) })}</Tag>
              ) : (
                <Tag tone="validated">{m.month_complete()}</Tag>
              ),
          },
        ]}
      />
    </AppShell>
  );
}
