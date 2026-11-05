import { expect, test } from 'vitest';
import { healthAccessAllowed } from '../../packages/backend/src/health-access';

const production = {
  DEPLOYMENT_ENV: 'production',
  HEALTH_TOKEN: 'a'.repeat(32),
};

test('production health reports require the exact bearer token', () => {
  expect(healthAccessAllowed(production, `Bearer ${'a'.repeat(32)}`)).toBe(
    true,
  );
  expect(healthAccessAllowed(production, undefined)).toBe(false);
  expect(healthAccessAllowed(production, '')).toBe(false);
  expect(healthAccessAllowed(production, `Bearer ${'b'.repeat(32)}`)).toBe(
    false,
  );
  expect(healthAccessAllowed(production, `Bearer ${'a'.repeat(31)}`)).toBe(
    false,
  );
  expect(healthAccessAllowed(production, 'a'.repeat(32))).toBe(false);
  expect(healthAccessAllowed(production, `Basic ${'a'.repeat(32)}`)).toBe(
    false,
  );
});

test('production fails closed without a configured token; other environments stay open', () => {
  expect(
    healthAccessAllowed({ DEPLOYMENT_ENV: 'production' }, 'Bearer anything'),
  ).toBe(false);
  expect(healthAccessAllowed({ DEPLOYMENT_ENV: 'local' }, undefined)).toBe(
    true,
  );
  expect(
    healthAccessAllowed({ DEPLOYMENT_ENV: 'development' }, undefined),
  ).toBe(true);
});
