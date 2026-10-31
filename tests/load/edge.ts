import { timingSafeEqual } from 'node:crypto';
import api from '../../apps/api/src/index';
import type { AppEnvironment } from '../../packages/backend/src/context';

// Temporary capacity Workers never expose the underlying API without the
// isolated run's credential. No schedules, payments or production bindings.
export default {
  fetch(
    request: Request<unknown, IncomingRequestCfProperties>,
    environment: AppEnvironment & { LOAD_TOKEN?: string },
    context: ExecutionContext,
  ) {
    const token = environment.LOAD_TOKEN;
    const provided = request.headers.get('x-kwikbus-load') ?? '';
    const database = new URL(environment.DATABASE_URL);
    if (
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !/^[a-f0-9]{64}$/.test(provided) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(provided)) ||
      !/^\/kwikbus_load_\d{8}$/.test(database.pathname) ||
      !database.hostname.endsWith('.neon.tech') ||
      environment.PAYMENTS_ENABLED !== 'false' ||
      environment.DEPLOYMENT_ENV !== 'development'
    )
      return new Response(null, { status: 404 });
    return api.fetch(request, environment, context);
  },
};
