import { createFileRoute } from '@tanstack/react-router';
import { receive } from '@/platform/chat';

// The WhatsApp webhook of the whole deployment: each notification names the number it was sent
// to, which names its organization; it is checked with that organization's own secret.
export const Route = createFileRoute('/api/chat/whatsapp')({
  server: {
    handlers: {
      GET: ({ request }) => receive('whatsapp', request),
      POST: ({ request }) => receive('whatsapp', request),
    },
  },
});
