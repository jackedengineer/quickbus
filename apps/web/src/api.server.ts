import { env } from 'cloudflare:workers';

export function apiFetch(request: Request): Promise<Response> {
  const bindings = env as unknown as { API: Fetcher };
  return bindings.API.fetch(request);
}
