import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  fixtureClient,
} from '../support/fixtures';

test('simultaneous Start SSR requests isolate customers and forward session renewal cookies', async () => {
  const client = await fixtureClient(),
    customers = await createCustomers(client, 2);
  try {
    await client.query(
      `UPDATE session SET expires_at=now()+interval '12 hours', updated_at=now()-interval '6 days' WHERE user_id=ANY($1::text[])`,
      [customers.map((customer) => customer.id)],
    );
    const pages = await Promise.all(
      customers.map((c) =>
        fetch('http://localhost:3000/', { headers: { Cookie: c.cookie } }),
      ),
    );
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i].status).toBe(200);
      expect(pages[i].headers.get('cache-control')).toContain('private');
      const renewed = pages[i].headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('better-auth.session_token='));
      // Assert booleans so credentials cannot appear in a failed diff.
      expect(Boolean(renewed)).toBe(true);
      expect(Boolean(renewed?.includes('HttpOnly'))).toBe(true);
      expect(Boolean(renewed?.includes('SameSite=Lax'))).toBe(true);
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
