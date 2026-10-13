import { Button, ErrorNote, Panel, TextAreaField } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { AskOutcome, Turn } from '@/features/assistant';
import { askQuestion } from '@/features/assistant/functions';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/demander')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  component: AskPage,
});

/** « Demander »: a question, answered with the readings she may open — nothing is changed. */
function AskPage() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<(Turn & { sources?: string[] })[]>([]);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState<
    Exclude<AskOutcome, { available: true }>['reason'] | null
  >(null);

  async function ask() {
    const asked = question.trim();
    if (!asked) return;
    setPending(true);
    setUnavailable(null);
    const outcome = await askQuestion({
      data: { question: asked, history: turns.map(({ role, text }) => ({ role, text })) },
    });
    setPending(false);
    if (!outcome.available) {
      setUnavailable(outcome.reason);
      return;
    }
    setQuestion('');
    setTurns((all) => [
      ...all,
      { role: 'user', text: asked },
      { role: 'assistant', text: outcome.answer, sources: outcome.sources },
    ]);
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-headline font-semibold">{m.ask_title()}</h1>
        <p className="text-fg-muted">{m.ask_intro()}</p>
        <div role="log" aria-live="polite" className="flex flex-col gap-3">
          {turns.map((turn, index) => (
            <Panel key={index} title={turn.role === 'user' ? m.ask_you() : m.ask_assistant()}>
              <p className="whitespace-pre-wrap">{turn.text}</p>
              {turn.sources && turn.sources.length > 0 && (
                <p className="mt-2 text-body-sm text-fg-muted">
                  {m.ask_sources({ sources: turn.sources.join(', ') })}
                </p>
              )}
            </Panel>
          ))}
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <TextAreaField
            label={m.ask_question()}
            value={question}
            rows={3}
            maxLength={2000}
            onChange={setQuestion}
          />
          <ErrorNote>
            {unavailable === 'not_connected'
              ? m.ask_not_connected()
              : unavailable === 'budget_spent'
                ? m.ask_budget_spent()
                : null}
          </ErrorNote>
          <div>
            <Button type="submit" disabled={pending || !question.trim()}>
              {pending ? m.ask_pending() : m.ask_send()}
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
