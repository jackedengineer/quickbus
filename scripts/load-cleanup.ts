import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadTarget } from './load-target';

const { client, directory, endpoint } = loadTarget();
await client.connect();
try {
  const fixture = JSON.parse(
    await readFile(`${directory}/fixture.json`, 'utf8'),
  ) as {
    customers: { id: string; cookie: string }[];
    loadToken?: string;
  };
  if (
    process.argv.includes('--edge') &&
    !/^[a-f0-9]{64}$/.test(fixture.loadToken ?? '')
  )
    throw Error('The edge fixture credential is missing.');
  const cookies = new Map(
    fixture.customers.map((user) => [user.id, user.cookie]),
  );
  const rows = (
    await client.query<{
      id: string;
      user_id: string;
    }>(`SELECT b.id,b.user_id FROM bookings b
    JOIN trips t ON t.id=b.trip_id WHERE t.operator_name='Load fixture'
    AND b.status IN ('HELD','PAYMENT_PENDING') ORDER BY b.id LIMIT 500`)
  ).rows;
  console.log(
    JSON.stringify({
      eligible: rows.length,
      executing: process.argv.includes('--execute'),
    }),
  );
  if (process.argv.includes('--execute')) {
    for (let start = 0; start < rows.length; start += 5) {
      await Promise.all(
        rows.slice(start, start + 5).map(async (booking) => {
          const cookie = cookies.get(booking.user_id);
          if (!cookie)
            throw Error('Cleanup found a customer outside this fixture.');
          const response = await fetch(
            `${endpoint}/api/v1/bookings/${booking.id}/release`,
            {
              method: 'POST',
              headers: {
                Cookie: cookie,
                Origin: 'http://localhost:3002',
                'Content-Type': 'application/json',
                'Idempotency-Key': randomUUID(),
                ...(process.argv.includes('--edge')
                  ? { 'x-kwikbus-load': fixture.loadToken! }
                  : {}),
              },
              body: '{}',
              signal: AbortSignal.timeout(20000),
            },
          );
          if (!response.ok)
            throw Error(
              'Normal fixture release failed. Preserve the run and retry cleanup.',
            );
        }),
      );
    }
    console.log(
      'Fixture reservations released through the normal owned HTTP command.',
    );
  }
} finally {
  await client.end();
}
