import type { DraftReview } from '@kete/capabilities';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { registry } from '@/platform/registry';
import { personOf } from '@/platform/session';
import { signedIn } from '@/platform/screen';
import { syncCenter } from '@/platform/sync';

/** A draft as the verification screen shows it: plain, serializable values. */
export interface ReviewScreen {
  draftId: string;
  description: string;
  autonomy: 3 | 4;
  status: 'prepared' | 'validated' | 'refused';
  fields: {
    key: string;
    title: string;
    value: string;
    source: string | null;
    uncertain: boolean;
  }[];
}

/** A value as a person reads it: a document's lines one by one, never `[object Object]`. */
function said(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(said).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${said(entry)}`)
      .join(' · ');
  }
  return String(value);
}

function toScreen(review: DraftReview): ReviewScreen {
  const properties = (review.schema['properties'] ?? {}) as Record<string, { title?: string }>;
  return {
    draftId: review.draftId,
    description: review.description,
    autonomy: review.autonomy,
    status: review.status,
    fields: Object.entries(review.values).map(([key, value]) => {
      const provenance = review.provenance[key];
      return {
        key,
        title: properties[key]?.title ?? key,
        value: said(value),
        source: provenance?.source ?? null,
        uncertain: provenance?.certainty === 'low',
      };
    }),
  };
}

export const fetchPerson = createServerFn({ method: 'GET' }).handler(async () => {
  const identity = await personOf(getRequest());
  return identity ? { name: identity.name, organizationId: identity.organizationId } : null;
});

/** A draft an agent prepared, as the person sees it before deciding. */
export const fetchReview = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ draftId: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { caller, as } = await signedIn();
    const review = await as(() => registry.review(caller, data.draftId));
    return review ? toScreen(review) : null;
  });

/** The person decides; level 4 arrives here already confirmed by the screen's dialog. */
export const decideReview = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('validate'),
          draftId: z.string().min(1).max(128),
          confirmed: z.boolean(),
        }),
        z.object({
          action: z.literal('refuse'),
          draftId: z.string().min(1).max(128),
          reason: z.string().trim().min(1).max(1000),
        }),
      ])
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { caller, as, token } = await signedIn();
    const decided = await as(() =>
      data.action === 'validate'
        ? registry.decide({
            ...caller,
            draftId: data.draftId,
            action: 'validate',
            confirmed: data.confirmed,
          })
        : registry.decide({
            ...caller,
            draftId: data.draftId,
            action: 'refuse',
            reason: data.reason,
          }),
    );
    // What she validated may wait for a decision of the center: it is asked.
    if (data.action === 'validate') await syncCenter(token, caller);
    return { status: decided.status };
  });
