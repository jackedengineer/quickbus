// Official Node HTTP adapter: https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '@kwikbus/backend/app';
import { type AppEnvironment, requestContext } from '@kwikbus/backend/context';
import { runMaintenance } from '@kwikbus/backend/maintenance';
import { runPaymentJobs } from '@kwikbus/backend/payment-worker';
import {
  observeRequest,
  reportFailure,
  requestId,
} from '@kwikbus/backend/telemetry';
import { createDatabase } from '@kwikbus/db';
import { validateEnvironment } from './environment';

const app = createApp();
app.listen(3001);
const handler = httpServerHandler({ port: 3001 });
const handleHttp = handler.fetch;
if (!handleHttp)
  throw new Error('The Cloudflare Node HTTP adapter is unavailable.');

const api = {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>,
    environment: AppEnvironment,
    executionContext: ExecutionContext,
  ) {
    if (new URL(request.url).pathname === '/api/health/live') {
      return handleHttp(request, environment, executionContext);
    }
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      validateEnvironment(environment);
      database = createDatabase(
        environment.DATABASE_URL,
        environment.CI_DATABASE_PROXY,
        requestId(),
      );
      const response = await requestContext.run(
        { db: database.db, environment },
        () => handleHttp(request, environment, executionContext),
      );
      if (
        response.ok &&
        request.method === 'POST' &&
        (new URL(request.url).pathname === '/api/webhooks/razorpay' ||
          /\/bookings\/[^/]+\/(checkout|payment\/(verify|refresh))$/.test(
            new URL(request.url).pathname,
          ))
      ) {
        executionContext.waitUntil(
          (async () => {
            const workerDb = createDatabase(
              environment.DATABASE_URL,
              environment.CI_DATABASE_PROXY,
            );
            try {
              await runPaymentJobs(workerDb.db, environment, 3);
            } finally {
              await workerDb.close();
            }
          })(),
        );
      }
      return response;
    } catch {
      reportFailure('worker_dependency_failed');
      return Response.json(
        { code: 'DEPENDENCY_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    } finally {
      await database?.close();
    }
  },
};

export default {
  async scheduled(
    controller: ScheduledController,
    environment: AppEnvironment,
  ) {
    validateEnvironment(environment);
    const job =
      controller.cron === '* * * * *'
        ? 'expiry'
        : controller.cron === '17 * * * *'
          ? 'inventory'
          : null;
    if (!job) throw new Error('Unknown maintenance schedule.');
    const runId = crypto.randomUUID();
    const database = createDatabase(
      environment.DATABASE_URL,
      environment.CI_DATABASE_PROXY,
      runId,
    );
    try {
      await runMaintenance(database.db, job, runId);
      if (job === 'expiry')
        await runMaintenance(database.db, 'payments', runId, environment);
    } finally {
      await database.close();
    }
  },
  fetch: (...args: Parameters<typeof api.fetch>) =>
    observeRequest(args[0], 'api', () => api.fetch(...args)),
};
