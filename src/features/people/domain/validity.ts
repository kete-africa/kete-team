import { plusDays } from '@/lib/days';

// Whether an authorisation covers a period, pure and light: the server decides with it, and a
// screen may show the same answer. Days are `2026-10-13`: they compare as text.

/** An authorisation a person holds. */
export interface Held {
  kindId: string;
  validFrom: string;
  /** The last day it is valid; null when it never expires. */
  validUntil: string | null;
}

export interface Missing {
  kindId: string;
  name: string;
  /** She never held it, or what she holds does not cover the whole period. */
  why: 'missing' | 'expired';
  /** The last day of the latest one she holds, when she holds one. */
  until: string | null;
}

/**
 * Whether what a person holds covers a kind for a whole period. Authorisations that overlap or
 * follow each other without a day between them count as one — a renewal continues what it renews
 * — and a day without any is a day she may not work: the period is then not covered.
 */
export function covering(
  held: readonly Held[],
  kindId: string,
  from: string,
  to: string,
): 'valid' | 'missing' | 'expired' {
  const ofKind = held
    .filter((one) => one.kindId === kindId)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (ofKind.length === 0) return 'missing';
  // Walk the days she is covered from the period's first day, one authorisation after another.
  let reached: string | null = null;
  for (const one of ofKind) {
    const starts: string = reached === null ? from : plusDays(reached, 1);
    if (one.validFrom > starts) continue;
    if (one.validUntil === null) return 'valid';
    if (one.validUntil >= to) return 'valid';
    if (one.validUntil >= starts && (reached === null || one.validUntil > reached)) {
      reached = one.validUntil;
    }
  }
  return 'expired';
}

/** What a period requires that a person does not hold for all of it. */
export function missingFor(
  required: readonly { kindId: string; name: string }[],
  held: readonly Held[],
  from: string,
  to: string,
): Missing[] {
  return required.flatMap((kind) => {
    const state = covering(held, kind.kindId, from, to);
    if (state === 'valid') return [];
    const last = held
      .filter((one) => one.kindId === kind.kindId)
      .map((one) => one.validUntil)
      .filter((until): until is string => until !== null)
      .sort()
      .at(-1);
    return [{ kindId: kind.kindId, name: kind.name, why: state, until: last ?? null }];
  });
}

/** Whether two periods share at least a day. */
export function overlaps(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}
