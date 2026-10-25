import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  fixtureClient,
} from '../support/fixtures';

test('magic links are stored hashed and only one of two simultaneous redemptions creates a session', async () => {
  const client = await fixtureClient(),
    customers = await createCustomers(client, 1),
    email = `${customers[0].id}@quickbus.test`;
  try {
    const sent = await fetch(
      'http://localhost:8787/api/auth/sign-in/magic-link',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, callbackURL: '/' }),
      },
    );
    expect(sent.status).toBe(200);
    const inbox = await fetch('http://localhost:8025/api/v1/messages');
    const data = (await inbox.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const message = data.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    );
    expect(message).toBeDefined();
    const full = await fetch(
      `http://localhost:8025/api/v1/message/${message?.ID}`,
    );
    const content = (await full.json()) as { Text: string };
    const match = content.Text.match(
      /http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\?[^\s]+/,
    );
    expect(Boolean(match)).toBe(true);
    const link = new URL(match?.[0] ?? 'http://localhost');
    const token = link.searchParams.get('token');
    expect(Boolean(token)).toBe(true);
    const stored = await client.query(
      'SELECT identifier,value FROM verification WHERE value LIKE $1',
      [`%${email}%`],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].identifier === token).toBe(false);
    expect(stored.rows[0].value.includes(token)).toBe(false);
    const before = await client.query(
      'SELECT count(*)::int AS count FROM session WHERE user_id=$1',
      [customers[0].id],
    );
    const results = await Promise.all(
      [8787, 8788].map((port) =>
        fetch(`http://localhost:${port}${link.pathname}${link.search}`, {
          redirect: 'manual',
        }),
      ),
    );
    // Do not print the callback URL or any Set-Cookie value in test output.
    expect(
      results
        .map((r) =>
          Boolean(
            r.headers.get('set-cookie')?.includes('better-auth.session_token='),
          ),
        )
        .filter(Boolean),
    ).toHaveLength(1);
    const after = await client.query(
      'SELECT count(*)::int AS count FROM session WHERE user_id=$1',
      [customers[0].id],
    );
    expect(after.rows[0].count - before.rows[0].count).toBe(1);
  } finally {
    await client.query('DELETE FROM verification WHERE value LIKE $1', [
      `%${email}%`,
    ]);
    await cleanupFixtures(
      client,
      [],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});
