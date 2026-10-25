import { expect, test } from 'vitest';

test('the Workers API reaches the configured PostgreSQL 18 database', async () => {
  const response = await fetch('http://localhost:8787/api/health/ready');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'ok',
    postgresMajor: 18,
  });
});
