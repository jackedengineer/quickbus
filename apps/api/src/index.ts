// Official Node HTTP adapter: https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '@kwikbus/backend/app';
import { type AppEnvironment, requestContext } from '@kwikbus/backend/context';
import { createDatabase } from '@kwikbus/db';
import { validateEnvironment } from './environment';

const app = createApp();
app.listen(3001);
const handler = httpServerHandler({ port: 3001 });
const handleHttp = handler.fetch;
if (!handleHttp)
  throw new Error('The Cloudflare Node HTTP adapter is unavailable.');

export default {
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
      database = createDatabase(environment.DATABASE_URL);
      return await requestContext.run({ db: database.db, environment }, () =>
        handleHttp(request, environment, executionContext),
      );
    } catch {
      console.error(JSON.stringify({ event: 'worker_dependency_failed' }));
      return Response.json(
        { code: 'DEPENDENCY_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    } finally {
      await database?.close();
    }
  },
};
