import { hash, HttpError, onlyKeys, page, text } from './http';
import type { Booking, Env } from './types';

export function publicBooking(row: Booking) {
  return {
    booking_id: row.booking_id, status: row.status, price: row.price,
    pay_to: row.pay_to, memo: row.booking_id,
    created_at: row.created_at, updated_at: row.updated_at,
    payment_instructions: 'Pay via SharedNet only after confirming the recipient. Use booking_id as memo. Payment requires manual verification of a transaction linked to this booking; a payment claim or balance change is not proof.'
  };
}

export async function getBooking(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM bookings WHERE booking_id = ?').bind(id).first<Booking>();
  if (!row) throw new HttpError(404, 'not_found', 'Booking not found.');
  return row;
}

export async function createBooking(env: Env, input: Record<string, unknown>, key?: string | null) {
  onlyKeys(input, ['seller_name', 'seller_payee_id', 'service_summary', 'how_to_invoke', 'contact_room_id']);
  const data = {
    seller_name: text(input.seller_name, 'seller_name', 100),
    seller_payee_id: text(input.seller_payee_id, 'seller_payee_id', 100),
    service_summary: text(input.service_summary, 'service_summary', 1000),
    how_to_invoke: text(input.how_to_invoke, 'how_to_invoke', 8000),
    contact_room_id: input.contact_room_id == null ? null : text(input.contact_room_id, 'contact_room_id', 100)
  };
  if (!/^p_[A-Za-z0-9_-]+$/.test(data.seller_payee_id)) {
    throw new HttpError(400, 'invalid_input', 'seller_payee_id must be a Principal id (p_...).');
  }
  if (data.contact_room_id && !/^rom_[A-Za-z0-9_-]+$/.test(data.contact_room_id)) {
    throw new HttpError(400, 'invalid_input', 'contact_room_id must be a room id.');
  }
  if (key != null && !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new HttpError(400, 'invalid_input', 'Idempotency-Key must be 8–128 ASCII letters, digits, or ._:-.');
  }
  const price = Number(env.REVIEW_PRICE);
  if (!Number.isSafeInteger(price) || price <= 0 || !/^p_[A-Za-z0-9_-]+$/.test(env.PAY_TO ?? '')) {
    throw new HttpError(503, 'not_configured', 'Payment configuration unavailable.');
  }
  const requestHash = await hash(JSON.stringify(data));
  const id = `bk_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // The UNIQUE key and conflict target make concurrent retries create exactly one row.
  await env.DB.prepare(`INSERT INTO bookings
    (booking_id,seller_name,seller_payee_id,service_summary,how_to_invoke,contact_room_id,
     price,pay_to,idempotency_key,request_hash,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(id, data.seller_name, data.seller_payee_id, data.service_summary, data.how_to_invoke,
      data.contact_room_id, price, env.PAY_TO, key ?? null, requestHash, now, now).run();
  const row = key ? await env.DB.prepare('SELECT * FROM bookings WHERE idempotency_key = ?').bind(key).first<Booking>()
    : await getBooking(env, id);
  if (!row) throw new Error('Booking insert failed.');
  if (row.request_hash !== requestHash) throw new HttpError(409, 'idempotency_conflict', 'Key already used with a different request.');
  return { data: publicBooking(row), created: row.booking_id === id };
}

export async function queue(env: Env, url: URL) {
  const { limit, offset } = page(url);
  const { results } = await env.DB.prepare(`SELECT booking_id,seller_name,service_summary,status,created_at
    FROM bookings WHERE status IN ('paid','testing','published','failed')
    ORDER BY created_at,booking_id LIMIT ? OFFSET ?`).bind(limit + 1, offset).all();
  return { items: results.slice(0, limit), next_offset: results.length > limit ? offset + limit : null };
}
