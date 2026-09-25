export interface Env {
  DB: D1Database;
  REVIEW_PRICE: string;
  PAY_TO: string;
  ADMIN_TOKEN?: string;
}

export type Status = 'pending_payment' | 'paid' | 'testing' | 'published' | 'failed' | 'refunded';
export interface Booking {
  booking_id: string;
  seller_name: string;
  seller_payee_id: string;
  service_summary: string;
  how_to_invoke: string;
  contact_room_id: string | null;
  price: number;
  pay_to: string;
  status: Status;
  idempotency_key: string | null;
  request_hash: string;
  created_at: string;
  updated_at: string;
}
