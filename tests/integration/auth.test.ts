import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  fixtureClient,
} from '../support/fixtures';

test('OTP is hashed and only one concurrent redemption creates a session; password and magic-link routes are absent', async () => {
  const client = await fixtureClient(),
    customers = await createCustomers(client, 1);
  const email = `${customers[0].id}@quickbus.test`;
  const post = (port: number, path: string, body: object) =>
    fetch(`http://localhost:${port}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  try {
    const sent = await post(8787, 'email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    });
    expect(sent.status).toBe(200);
    const inbox = (await (
      await fetch('http://localhost:8025/api/v1/messages')
    ).json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    const message = inbox.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    );
    expect(Boolean(message)).toBe(true);
    const content = (await (
      await fetch(`http://localhost:8025/api/v1/message/${message?.ID}`)
    ).json()) as { Text: string };
    const otp = content.Text.match(/code is (\d{6})/)?.[1];
    expect(Boolean(otp)).toBe(true);
    const stored = await client.query(
      'SELECT value FROM verification WHERE identifier=$1',
      [`sign-in-otp-${email}`],
    );
    expect(stored.rowCount).toBe(1);
    // Do not include the OTP, stored hash, token or cookie in assertion output.
    expect(stored.rows[0].value.startsWith(`${otp}:`)).toBe(false);
    const before = await client.query(
      'SELECT count(*)::int AS count FROM session WHERE user_id=$1',
      [customers[0].id],
    );
    const results = await Promise.all(
      [8787, 8788].map((port) =>
        post(port, 'sign-in/email-otp', { email, otp }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await client.query(
      'SELECT count(*)::int AS count FROM session WHERE user_id=$1',
      [customers[0].id],
    );
    expect(after.rows[0].count - before.rows[0].count).toBe(1);
    expect((await post(8787, 'sign-in/email-otp', { email, otp })).ok).toBe(
      false,
    );
    for (const path of [
      'sign-in/magic-link',
      'sign-in/email',
      'sign-up/email',
      'email-otp/reset-password',
      'email-otp/check-verification-otp',
    ]) {
      expect((await post(8787, path, { email })).status).toBe(404);
    }
  } finally {
    await client.query('DELETE FROM verification WHERE identifier=$1', [
      `sign-in-otp-${email}`,
    ]);
    await cleanupFixtures(
      client,
      [],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});
