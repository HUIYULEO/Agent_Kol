ALTER TABLE reviews ADD COLUMN purchase_evidence TEXT;
ALTER TABLE reviews ADD COLUMN purchase_amount INTEGER;
ALTER TABLE transaction_references RENAME TO transaction_references_legacy;
CREATE TABLE transaction_references (
 transaction_id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT REFERENCES bookings(booking_id),
 review_id TEXT REFERENCES reviews(review_id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund','purchase')),
 created_at TEXT NOT NULL,
 CHECK((kind='purchase' AND review_id IS NOT NULL AND booking_id IS NULL) OR (kind IN ('payment','refund') AND booking_id IS NOT NULL AND review_id IS NULL))
);
INSERT INTO transaction_references(transaction_id,booking_id,kind,created_at) SELECT transaction_id,booking_id,kind,created_at FROM transaction_references_legacy;
DROP TABLE transaction_references_legacy;
