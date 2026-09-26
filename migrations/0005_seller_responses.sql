CREATE TABLE seller_responses (
 review_id TEXT PRIMARY KEY REFERENCES reviews(review_id),
 token_hash TEXT NOT NULL UNIQUE,
 response TEXT, created_at TEXT, issued_at TEXT NOT NULL
);
