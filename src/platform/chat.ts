import {
  chatOrganizationsWaiting,
  deliverChat,
  receiveChat,
  type ChatChannelName,
  type ChatOutboxOptions,
} from '@kete/notify';
import { getPool, transaction } from './db';
import { log } from './log';

// WhatsApp and Telegram (@kete/notify): each organization connects its own number or bot; a
// message leaves only to someone who agreed, in the organization's words, from its own sender.
// The credentials are sealed with `KETE_SECRETS_KEY`. What a message heard means is the app's
// trade: a feature reads `heard` and queues its answer with `queueChatReply`.

let options: ChatOutboxOptions = {};

/** Tests: channels in memory, another key. */
export function useChat(next: ChatOutboxOptions): void {
  options = next;
}

/** A provider's webhook: whose account, checked with that organization's own secret. */
export async function receive(
  channel: ChatChannelName,
  request: Request,
  account?: string,
): Promise<Response> {
  const received = await receiveChat(request, {
    ...options,
    channel,
    lookup: getPool(),
    inOrganization: transaction,
    ...(process.env.KETE_WHATSAPP_VERIFY_TOKEN
      ? { verifyToken: process.env.KETE_WHATSAPP_VERIFY_TOKEN }
      : {}),
    ...(account ? { account } : {}),
  });
  if (received.heard.length > 0) {
    log.info('chat heard', { channel, messages: received.heard.length });
  }
  return received.response;
}

/** The worker, every minute: what waits to leave, organization by organization. */
export async function deliverWaiting(): Promise<void> {
  for (const organizationId of await chatOrganizationsWaiting(getPool())) {
    const done = await transaction(organizationId, (db) => deliverChat(db, options));
    if (done.failed > 0 || done.retried > 0)
      log.warn('chat not delivered', { organizationId, ...done });
  }
}
