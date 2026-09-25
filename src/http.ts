export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// Limit actual streamed bytes, including requests without Content-Length.
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Use application/json.');
  }
  const max = 32768;
  if (Number(request.headers.get('Content-Length')) > max) {
    throw new HttpError(413, 'body_too_large', 'Body exceeds 32 KiB.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_json', 'JSON object required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large', 'Body exceeds 32 KiB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    return object(value);
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON object required.');
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_input', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, 'invalid_input', `${field} must be 1–${max} characters.`);
  }
  return value.trim();
}

export function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) {
    throw new HttpError(400, 'invalid_input', 'Unexpected field.');
  }
}

export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function page(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? '20');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new HttpError(400, 'invalid_pagination', 'limit: 1–100; offset: 0–10000.');
  }
  return { limit, offset };
}

export function secure(response: Response): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
