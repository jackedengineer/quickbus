import { createFileRoute } from '@tanstack/react-router';
import { apiFetch } from '../api.server';

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => apiFetch(request),
      POST: ({ request }) => apiFetch(request),
      PATCH: ({ request }) => apiFetch(request),
    },
  },
});
