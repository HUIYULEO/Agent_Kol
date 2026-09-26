ALTER TABLE reviews RENAME TO reviews_legacy;
DROP INDEX reviews_created;
CREATE TABLE reviews (
 review_id TEXT PRIMARY KEY, booking_id TEXT UNIQUE REFERENCES bookings(booking_id),
 subject_id TEXT NOT NULL UNIQUE, funding_source TEXT NOT NULL CHECK(funding_source IN ('seller_paid','host_initiated','host_purchased','demo_example')),
 verdict TEXT NOT NULL CHECK(verdict IN ('recommended','mixed','not_recommended','inconclusive')),
 tested_at TEXT NOT NULL, what_we_called TEXT NOT NULL, result_summary TEXT NOT NULL,
 latency_ms REAL, pros TEXT NOT NULL, cons TEXT NOT NULL, how_to_buy TEXT NOT NULL,
 evidence TEXT NOT NULL, reproduce_cmd TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO reviews SELECT review_id,booking_id,booking_id,'seller_paid',verdict,tested_at,what_we_called,result_summary,latency_ms,pros,cons,how_to_buy,'[]','',content_hash,created_at FROM reviews_legacy;
DROP TABLE reviews_legacy;
CREATE INDEX reviews_created ON reviews(created_at,review_id);
CREATE TABLE probes (
 probe_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
 state TEXT NOT NULL, record TEXT, created_at TEXT NOT NULL, UNIQUE(subject_id,slot)
);
