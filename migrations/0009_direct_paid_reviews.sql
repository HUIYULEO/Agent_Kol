ALTER TABLE reviews ADD COLUMN payment_evidence TEXT;
ALTER TABLE reviews ADD COLUMN payment_amount INTEGER;
ALTER TABLE transaction_references RENAME TO transaction_references_previous;
CREATE TABLE transaction_references (
 transaction_id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT REFERENCES bookings(booking_id),
 review_id TEXT REFERENCES reviews(review_id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund','purchase')),
 created_at TEXT NOT NULL,
 CHECK((booking_id IS NOT NULL AND review_id IS NULL AND kind IN ('payment','refund')) OR (review_id IS NOT NULL AND booking_id IS NULL AND kind IN ('payment','purchase')))
);
INSERT INTO transaction_references(transaction_id,booking_id,review_id,kind,created_at)
 SELECT transaction_id,booking_id,review_id,kind,created_at FROM transaction_references_previous;
DROP TABLE transaction_references_previous;
