CREATE TABLE bookings (
  booking_id TEXT PRIMARY KEY,
  seller_name TEXT NOT NULL,
  seller_payee_id TEXT NOT NULL,
  service_summary TEXT NOT NULL,
  how_to_invoke TEXT NOT NULL,
  contact_room_id TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  pay_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','testing','published','failed','refunded')),
  idempotency_key TEXT UNIQUE,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bookings_queue ON bookings(status, created_at, booking_id);
