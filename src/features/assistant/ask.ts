import { memoriesFor, runAgent } from '@kete/agents';
import { BudgetExceededError } from '@kete/ai';
import type { Caller } from '@kete/capabilities';
import { getModel } from '@/platform/ai';
import { transaction } from '@/platform/db';
import { registry } from '@/platform/registry';

// « Demander » (kete-core specs 089 and 090): a question answered with the readings the person
// may open, and nothing else. The turn runs on the chassis' agents runtime (@kete/agents): its
// only tools are her level-1 capabilities, so it reads what she may read and changes nothing.

/** The assistant: an agent acting for the person who asks, never with more rights than hers. */
export const ASSISTANT = 'agt_ask';

/**
 * What the model is, and what it must never do. Written for the model, in English; it answers in
 * the person's language. Adapt it to the app's trade — keep the rules.
 */
export const SYSTEM = `You answer the questions of a person who works with this app.

Rules, in this order:
1. Every figure you give comes from a tool result of this conversation. You never compute, estimate or round a figure yourself.
2. When a tool says something is missing, say so plainly, and what is missing. Never fill the gap.
3. You never change anything: you only read. If the person asks for a change, say where in the app she can do it.
4. Answer in the language of the question, in two or three short sentences: the fact first, then where it comes from.
5. If the question is not about this app, say you only answer about it.`;

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export type AskOutcome =
  | { available: false; reason: 'not_connected' | 'budget_spent' }
  | {
      available: true;
      answer: string;
      /** The readings the answer rests on, in the order they were opened. */
      sources: string[];
    };

/** Answers a question for a person; to run within her rights (`asPerson`). */
export async function askApp(
  person: { userId: string; organizationId: string },
  question: string,
  history: readonly Turn[] = [],
): Promise<AskOutcome> {
  const model = getModel();
  if (!model) return { available: false, reason: 'not_connected' };
  const caller: Caller = {
    organizationId: person.organizationId,
    actor: {
      kind: 'agent',
      id: ASSISTANT,
      channel: 'chat',
      onBehalfOf: { kind: 'person', id: person.userId },
    },
  };
  // Readings only: what acts at once or prepares a draft is not offered here.
  const tools = (await registry.tools(caller)).filter((tool) => tool.autonomy === 1);
  const remembered = await transaction(person.organizationId, (db) =>
    memoriesFor(db, person.userId),
  );
  try {
    const answer = await runAgent({
      agent: ASSISTANT,
      model,
      instructions: SYSTEM,
      remembered,
      tools,
      maxSteps: 6,
      messages: [
        ...history
          .slice(-12)
          .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 2000) })),
        {
          role: 'user' as const,
          // The model does not know the date: without it, « this month » is a month of its own.
          content: `[Today: ${new Date().toISOString().slice(0, 10)}]\n${question.slice(0, 2000)}`,
        },
      ],
    });
    return {
      available: true,
      answer: answer.text.trim(),
      sources: [
        ...new Set(answer.calls.filter((call) => call.status === 'done').map((call) => call.name)),
      ],
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) return { available: false, reason: 'budget_spent' };
    throw error;
  }
}
