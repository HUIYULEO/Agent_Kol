ALTER TABLE bookings ADD COLUMN refund_evidence TEXT;
ALTER TABLE bookings ADD COLUMN refund_reference TEXT;
CREATE TABLE transaction_references (
 transaction_id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
 created_at TEXT NOT NULL
);
INSERT INTO transaction_references(transaction_id,booking_id,kind,created_at)
 SELECT payment_reference,booking_id,'payment',updated_at FROM bookings WHERE payment_reference IS NOT NULL;
