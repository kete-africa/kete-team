import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { decisionOf } from '@/features/leave';
import { centerAppToken } from '@/platform/events';
import { log } from '@/platform/log';

const told = z.object({
  requestId: z.string().min(1).max(64),
  organizationId: z.string().min(1).max(64),
});

/**
 * Where the center says one of its requests was decided (kete-core spec 049): it sends the
 * request's id only. Nothing here is believed: the app reads the decision at the center, with its
 * own token, and applies what it read.
 */
export const Route = createFileRoute('/api/centre/decisions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = told.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: 'invalid_input' }, { status: 422 });
        try {
          await decisionOf(await centerAppToken(), body.data.organizationId, body.data.requestId);
        } catch (error) {
          log.warn('decision not read at the center', { error });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
