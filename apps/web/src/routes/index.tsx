import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { apiFetch } from '../api.server';

const getHealth = createServerFn({ method: 'GET' }).handler(async () => {
  const response = await apiFetch(
    new Request('http://quickbus.internal/api/health/live'),
  );
  if (!response.ok) throw new Error('The API is unavailable.');
  return response.json() as Promise<{ status: string; runtime: string }>;
});

export const Route = createFileRoute('/')({
  loader: () => getHealth(),
  component: Home,
});

function Home() {
  const health = Route.useLoaderData();
  return (
    <main id="main">
      <p className="eyebrow">A better way to get there</p>
      <h1>
        Your next journey,
        <br />a little simpler.
      </h1>
      <p className="lede">
        Clear fares. Your choice of seat. A reservation you can trust.
      </p>
      <section className="panel" aria-labelledby="preview-title">
        <h2 id="preview-title">Building the foundations</h2>
        <p>Trip search and seat reservations are coming next.</p>
        <p className="status" role="status">
          API connected · {health.runtime}
        </p>
      </section>
    </main>
  );
}
