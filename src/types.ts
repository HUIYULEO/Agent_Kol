export interface Env {
 DB:D1Database; REVIEW_PRICE:string; PAY_TO:string; ADMIN_TOKEN?:string;
 PAYMENT_WINDOW_SECONDS?:string; ALLOW_AGGREGATE_PAYMENTS?:string;
}
export type Status='pending_payment'|'awaiting_payment'|'payment_ambiguous'|'paid'|'testing'|'published'|'failed'|'refunded'|'cancelled';
export interface Booking {
 booking_id:string;seller_name:string;seller_payee_id:string;service_summary:string;how_to_invoke:string;contact_room_id:string|null;
 price:number;pay_to:string;status:Status;idempotency_key:string|null;request_hash:string;created_at:string;updated_at:string;
 queue_at:string;version:number;last_event_id:string|null;received_baseline:number|null;payment_opened_at:string|null;payment_deadline:string|null;
 payment_evidence:string|null;payment_reference:string|null;refund_reference:string|null;refund_evidence:string|null;
}
