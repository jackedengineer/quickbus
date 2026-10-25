// Official Node HTTP adapter: https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';

const app = express();
app.disable('x-powered-by');
app.get('/api/health/live', (_request, response) => {
  response.json({ status: 'ok', runtime: 'cloudflare-workers' });
});
app.listen(3001);
export default httpServerHandler({ port: 3001 });
