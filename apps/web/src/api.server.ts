import { env } from 'cloudflare:workers';
import { requestId, timed } from '@kwikbus/backend/telemetry';

export async function apiFetch(request: Request): Promise<Response> {
  const bindings = env as unknown as { API: Fetcher };
  if (['POST', 'PATCH'].includes(request.method) && request.body) {
    // The backend is private, so enforce a byte limit at its only public entry.
    // Checking Content-Length alone would miss streamed/chunked request bodies.
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const limit =
      request.method === 'POST' &&
      new URL(request.url).pathname === '/api/webhooks/razorpay'
        ? 256 * 1024
        : 16 * 1024;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return Response.json({ code: 'REQUEST_TOO_LARGE' }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers(request.headers);
    headers.delete('Content-Length');
    request = new Request(request, { body, headers });
  }
  const headers = new Headers(request.headers);
  const correlation = requestId();
  if (correlation) headers.set('X-Request-Id', correlation);
  else headers.delete('X-Request-Id');
  return timed('binding', () =>
    bindings.API.fetch(new Request(request, { headers })),
  );
}
