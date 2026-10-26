import { expect, test, vi } from 'vitest';
import {
  observeRequest,
  requestId,
  routeLabel,
  timed,
} from '../../packages/backend/src/telemetry';

test('parallel traces remain isolated and never log a callback query or raw unknown path', async () => {
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        observeRequest(
          new Request(
            `https://kwikbus.test/api/auth/callback/google?code=private-${i}`,
            { headers: { 'X-Request-Id': 'attacker-controlled' } },
          ),
          'web',
          async () => {
            const before = requestId();
            await timed(
              'binding',
              () => new Promise((resolve) => setTimeout(resolve, i)),
            );
            expect(requestId()).toBe(before);
            return new Response('ok');
          },
        ),
      ),
    );
    expect(
      new Set(responses.map((r) => r.headers.get('X-Request-Id'))).size,
    ).toBe(8);
    expect(
      responses.every((r) =>
        r.headers.get('Server-Timing')?.includes('binding;dur='),
      ),
    ).toBe(true);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-');
    expect(JSON.stringify(logs.mock.calls)).not.toContain(
      'attacker-controlled',
    );
    expect(routeLabel('/email@example.com/token')).toBe('other');
    expect(routeLabel('/api/v1/bookings/secret-id/release')).toBe(
      '/api/v1/bookings/:id/release',
    );
    const id = responses[0].headers.get('X-Request-Id') ?? '';
    const downstream = await observeRequest(
      new Request('https://internal/api/v1/trips', {
        headers: { 'X-Request-Id': id },
      }),
      'api',
      () => new Response('ok'),
    );
    expect(downstream.headers.get('X-Request-Id')).toBe(id);
  } finally {
    logs.mockRestore();
  }
});

test('CI transport overrides cannot target a remote or production database', async () => {
  const { createDatabase } = await import('../../packages/db/src/client');
  for (const target of [
    'postgresql://unused:unused@example.com:55432/quickbus_ci?sslmode=disable',
    'postgresql://unused:unused@127.0.0.1:55432/kwikbus_v0?sslmode=disable',
  ])
    expect(() => createDatabase(target, '127.0.0.1:6543')).toThrow(
      'isolated loopback',
    );
});
