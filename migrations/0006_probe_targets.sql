CREATE TABLE probe_targets (url TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('room_message','booking')), source_ref TEXT NOT NULL, approved_at TEXT NOT NULL);
