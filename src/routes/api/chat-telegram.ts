import { createFileRoute } from '@tanstack/react-router';
import { receive } from '@/platform/chat';

// The Telegram webhook of one bot: an update does not name its bot, so the address does — the
// bot's identifier, which names its organization; checked with that organization's own secret.
export const Route = createFileRoute('/api/chat/telegram/$account')({
  server: {
    handlers: {
      POST: ({ request, params }) => receive('telegram', request, params.account),
    },
  },
});
