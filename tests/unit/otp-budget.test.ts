import { expect, test } from 'vitest';
import {
  consumeOtpSend,
  OTP_SENDS_PER_ADDRESS,
} from '../../packages/backend/src/otp-budget';
import type { Database } from '../../packages/db/src/client';

function fakeDatabase(counts: number[]) {
  const queries: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      queries.push(query);
      return { rows: [{ count: counts.shift() }] };
    },
  } as unknown as Database;
  return { db, queries };
}

test('an address may receive its budget of codes and no more', async () => {
  const { db } = fakeDatabase([
    OTP_SENDS_PER_ADDRESS - 1,
    OTP_SENDS_PER_ADDRESS,
    OTP_SENDS_PER_ADDRESS + 1,
  ]);
  const secret = 's'.repeat(32);
  expect(await consumeOtpSend(db, secret, 'rider@example.com')).toBe(true);
  expect(await consumeOtpSend(db, secret, 'rider@example.com')).toBe(true);
  expect(await consumeOtpSend(db, secret, 'rider@example.com')).toBe(false);
});

test('the stored key is a keyed hash that ignores case and never contains the address', async () => {
  // Interpolated values appear in the query's chunks as bare primitives.
  const params: unknown[][] = [];
  const db = {
    execute: async (query: { queryChunks: unknown[] }) => {
      params.push(
        query.queryChunks.filter(
          (c) => typeof c === 'string' || typeof c === 'number',
        ),
      );
      return { rows: [{ count: 1 }] };
    },
  } as unknown as Database;
  const secret = 's'.repeat(32);
  await consumeOtpSend(db, secret, 'Rider@Example.com ');
  await consumeOtpSend(db, secret, 'rider@example.com');
  await consumeOtpSend(db, 'x'.repeat(32), 'rider@example.com');
  const keyOf = (p: unknown[]) =>
    p.find((v) => typeof v === 'string' && v.startsWith('otp-address:'));
  expect(keyOf(params[0])).toMatch(/^otp-address:[0-9a-f]{64}$/);
  expect(keyOf(params[0])).toBe(keyOf(params[1]));
  expect(keyOf(params[2])).not.toBe(keyOf(params[0]));
  expect(JSON.stringify(params)).not.toContain('example.com');
});
