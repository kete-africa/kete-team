// Days, pure and light: the server counts with them, and a form shows the same count while she
// picks her dates. A day is `2026-10-13`.

export const leaveKinds = ['annual', 'sick', 'unpaid', 'other'] as const;
export type LeaveKind = (typeof leaveKinds)[number];

const DAY = 86_400_000;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The working days of a period, both ends included: Monday to Friday. Public holidays are not
 * known here — they count as worked until the organization's calendar says otherwise.
 */
export function workingDays(startsOn: string, endsOn: string): number {
  const from = at(startsOn);
  const to = at(endsOn);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  let days = 0;
  for (let time = from; time <= to; time += DAY) {
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** The Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const time = at(day);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY).toISOString().slice(0, 10);
}

/** The day `count` days after a day. */
export function plusDays(day: string, count: number): string {
  return new Date(at(day) + count * DAY).toISOString().slice(0, 10);
}
