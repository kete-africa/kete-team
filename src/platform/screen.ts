import { performGesture, type Outcome } from '@kete/capabilities';
import { getRequest } from '@tanstack/react-start/server';
import { registry } from './registry';
import { asPerson } from './rights';
import { personOf, screenActor, tokenOf } from './session';
import { recordUse } from './usage';

export class ScreenError extends Error {
  constructor(readonly code: 'signed_out' | 'no_organization' | 'forbidden' | 'not_found') {
    super(code);
    this.name = 'ScreenError';
  }
}

/** The person on this screen, in her organization, with her rights for what follows. */
export async function signedIn() {
  const request = getRequest();
  const identity = await personOf(request);
  if (!identity) throw new ScreenError('signed_out');
  if (!identity.organizationId) throw new ScreenError('no_organization');
  const token = await tokenOf(request);
  return {
    identity,
    caller: { actor: screenActor(identity), organizationId: identity.organizationId },
    /** Runs `work` with her rights: the center's grants, her business role, or her role's defaults. */
    as: <T>(work: () => T | Promise<T>) => asPerson(identity, work, token),
  };
}

/**
 * A person's gesture on a screen: the same capability an agent would call, under her rights. A
 * broken rule comes back as its code (`RuleError`), never as a crash: the screen words it from
 * `errors_<code>`. What she did is counted for her organization's usage.
 */
export async function perform<T = unknown>(
  name: string,
  input: unknown,
  /** The gesture's key: sent twice — a double tap, a retry — it runs once. */
  idempotencyKey?: string,
): Promise<Outcome<T>> {
  const { identity, caller, as } = await signedIn();
  const outcome = await performGesture<T>(
    registry,
    { ...caller, name, input, ...(idempotencyKey ? { idempotencyKey } : {}) },
    as,
  );
  if (outcome.ok) await recordUse(caller.organizationId, name, identity.userId);
  return outcome;
}
