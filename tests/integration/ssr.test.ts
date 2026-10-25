import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  fixtureClient,
} from '../support/fixtures';

test('simultaneous Start SSR requests keep two customer sessions isolated and private', async () => {
  const client = await fixtureClient(),
    customers = await createCustomers(client, 2);
  try {
    const pages = await Promise.all(
      customers.map((c) =>
        fetch('http://localhost:3000/', { headers: { Cookie: c.cookie } }),
      ),
    );
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i].status).toBe(200);
      expect(pages[i].headers.get('cache-control')).toContain('private');
      const html = await pages[i].text();
      expect(html.includes(customers[i].id)).toBe(true);
      expect(html.includes(customers[1 - i].id)).toBe(false);
    }
  } finally {
    await cleanupFixtures(
      client,
      [],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});
