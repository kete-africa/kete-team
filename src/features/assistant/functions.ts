import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { signedIn } from '@/platform/screen';
import { recordUse } from '@/platform/usage';
import { askApp } from './ask';

/** A question from the « Demander » screen, answered with her rights. */
export const askQuestion = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        question: z.string().trim().min(1).max(2000),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
          .max(24)
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    const outcome = await as(() =>
      askApp(
        { userId: identity.userId, organizationId: caller.organizationId },
        data.question,
        data.history,
      ),
    );
    if (outcome.available) await recordUse(caller.organizationId, 'assistant_ask', identity.userId);
    return outcome;
  });
