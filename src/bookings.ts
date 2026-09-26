import { hash, HttpError, onlyKeys, page, text } from './http';
import type { Booking, Env } from './types';

export function publicBooking(row: Booking) {
  return {
    booking_id: row.booking_id, status: row.status, price: row.price,
    pay_to: row.pay_to, memo: 'your team name',
    created_at: row.created_at, updated_at: row.updated_at, payment_deadline: row.payment_deadline, payment_window_open: row.status === 'awaiting_payment' && row.payment_deadline !== null && Date.parse(row.payment_deadline) > Date.now(),
    payment_instructions: 'Arena requests: pay the listed price directly to pay_to, with your own team name as memo; no invitation is needed. The host matches the ledger payer to your arena request principal. Legacy status fields do not gate Arena payment. The host agent verifies payment; a payment claim or balance change alone is not transaction proof.'
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
  const perPayee = Number(env.MAX_OPEN_BOOKINGS_PER_PAYEE ?? '2');
  const total = Number(env.MAX_OPEN_BOOKINGS ?? '30');
  if (![perPayee, total].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new HttpError(503, 'not_configured', 'Booking limits unavailable.');
  }
  const requestHash = await hash(JSON.stringify(data));
  // A retry of an existing key answers from that row, even when the limits are full.
  if (key) {
    const existing = await env.DB.prepare('SELECT * FROM bookings WHERE idempotency_key = ?').bind(key).first<Booking>();
    if (existing) return replay(existing, requestHash);
  }
  const id = `bk_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // Unpaid bookings are free to create, so cap them per payee and overall. The counts and
  // insert run as one statement; the UNIQUE key makes concurrent retries create one row.
  await env.DB.prepare(`INSERT INTO bookings
    (booking_id,seller_name,seller_payee_id,service_summary,how_to_invoke,contact_room_id,
     price,pay_to,idempotency_key,request_hash,created_at,updated_at,queue_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM bookings WHERE seller_payee_id = ? AND status IN (${OPEN})) < ?
      AND (SELECT COUNT(*) FROM bookings WHERE status IN (${OPEN})) < ?
    ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(id, data.seller_name, data.seller_payee_id, data.service_summary, data.how_to_invoke,
      data.contact_room_id, price, env.PAY_TO, key ?? null, requestHash, now, now, now,
      data.seller_payee_id, perPayee, total).run();
  const row = await env.DB.prepare(key ? 'SELECT * FROM bookings WHERE idempotency_key = ?' : 'SELECT * FROM bookings WHERE booking_id = ?')
    .bind(key ?? id).first<Booking>();
  if (row) return replay(row, requestHash, id);
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE seller_payee_id = ? AND status IN (${OPEN})`)
    .bind(data.seller_payee_id).first<{ n: number }>();
  if ((open?.n ?? 0) >= perPayee) {
    throw new HttpError(429, 'too_many_open_bookings', `At most ${perPayee} unpaid bookings per payee. Complete or cancel one first.`);
  }
  throw new HttpError(429, 'booking_queue_full', 'The review queue is full. Try again later.');
}

const OPEN = "'pending_payment','awaiting_payment','payment_ambiguous'";

function replay(row: Booking, requestHash: string, createdId?: string) {
  if (row.request_hash !== requestHash) throw new HttpError(409, 'idempotency_conflict', 'Key already used with a different request.');
  return { data: publicBooking(row), created: row.booking_id === createdId };
}

export async function queue(env: Env, url: URL) {
  const { limit, offset } = page(url);
  const { results } = await env.DB.prepare(`SELECT booking_id,seller_name,service_summary,status,created_at
    FROM bookings WHERE status IN ('paid','testing','published','failed')
    ORDER BY queue_at,booking_id LIMIT ? OFFSET ?`).bind(limit + 1, offset).all();
  return { items: results.slice(0, limit), next_offset: results.length > limit ? offset + limit : null };
}
