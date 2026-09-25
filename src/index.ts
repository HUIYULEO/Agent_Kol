import { createBooking, getBooking, publicBooking, queue } from './bookings';
import { HttpError, json, readJson, secure } from './http';
import type { Env } from './types';

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
  if (request.method === 'POST' && url.pathname === '/bookings') {
    const result = await createBooking(env, await readJson(request), request.headers.get('Idempotency-Key'));
    return json(result.data, result.created ? 201 : 200, { Location: `/bookings/${result.data.booking_id}` });
  }
  const booking = /^\/bookings\/(bk_[a-f0-9-]+)$/.exec(url.pathname);
  if (request.method === 'GET' && booking) return json(publicBooking(await getBooking(env, booking[1])));
  if (request.method === 'GET' && url.pathname === '/queue') return json(await queue(env, url));
  throw new HttpError(404, 'not_found', 'Route not found.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return secure(await route(request, env)); }
    catch (error) {
      if (error instanceof HttpError) return secure(json({ error: { code: error.code, message: error.message } }, error.status));
      // Do not log bodies, SQL bindings, seller instructions, or credentials.
      console.error('Unhandled request failure');
      return secure(json({ error: { code: 'internal_error', message: 'Request failed.' } }, 500));
    }
  }
};
