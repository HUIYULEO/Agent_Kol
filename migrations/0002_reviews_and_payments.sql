ALTER TABLE bookings RENAME TO bookings_v1;
DROP INDEX bookings_queue;
CREATE TABLE bookings (
 booking_id TEXT PRIMARY KEY, seller_name TEXT NOT NULL, seller_payee_id TEXT NOT NULL,
 service_summary TEXT NOT NULL, how_to_invoke TEXT NOT NULL, contact_room_id TEXT,
 price INTEGER NOT NULL CHECK(price>0), pay_to TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','awaiting_payment','payment_ambiguous','paid','testing','published','failed','refunded','cancelled')),
 idempotency_key TEXT UNIQUE, request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, queue_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, last_event_id TEXT,
 received_baseline INTEGER, payment_opened_at TEXT, payment_deadline TEXT,
 payment_evidence TEXT, payment_reference TEXT UNIQUE
);
INSERT INTO bookings (booking_id,seller_name,seller_payee_id,service_summary,how_to_invoke,contact_room_id,
price,pay_to,status,idempotency_key,request_hash,created_at,updated_at,queue_at)
SELECT booking_id,seller_name,seller_payee_id,service_summary,how_to_invoke,contact_room_id,
price,pay_to,status,idempotency_key,request_hash,created_at,updated_at,created_at FROM bookings_v1;
DROP TABLE bookings_v1;
CREATE INDEX bookings_queue ON bookings(status,queue_at,booking_id);
-- Every active or ambiguous row maps to the same key (1), allowing only one globally.
CREATE UNIQUE INDEX one_payment_window ON bookings((1)) WHERE status IN ('awaiting_payment','payment_ambiguous');
CREATE TABLE booking_events (
 event_id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
 from_status TEXT NOT NULL, to_status TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX booking_events_booking ON booking_events(booking_id,created_at);
CREATE TABLE reviews (
 review_id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(booking_id),
 verdict TEXT NOT NULL CHECK(verdict IN ('recommended','mixed','not_recommended','inconclusive')),
 tested_at TEXT NOT NULL, what_we_called TEXT NOT NULL, result_summary TEXT NOT NULL,
 latency_ms REAL, pros TEXT NOT NULL, cons TEXT NOT NULL, how_to_buy TEXT NOT NULL,
 content_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX reviews_created ON reviews(created_at,review_id);
