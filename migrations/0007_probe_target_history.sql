ALTER TABLE probe_targets ADD COLUMN provenance TEXT NOT NULL DEFAULT 'host_declared';
ALTER TABLE probe_targets ADD COLUMN state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked'));
UPDATE probe_targets SET provenance='system_verified' WHERE source_kind='booking' AND source_ref IN (SELECT booking_id FROM bookings);
CREATE TABLE probe_target_blocks(url TEXT PRIMARY KEY, revoked_at TEXT NOT NULL);
CREATE TABLE probe_target_events(event_id TEXT PRIMARY KEY,url TEXT NOT NULL,action TEXT NOT NULL,source_kind TEXT NOT NULL,source_ref TEXT NOT NULL,provenance TEXT NOT NULL,reason TEXT NOT NULL,at TEXT NOT NULL);
INSERT INTO probe_target_events SELECT 'legacy_'||lower(hex(randomblob(16))),url,'legacy_import',source_kind,source_ref,provenance,'Imported current approval; earlier history unavailable',approved_at FROM probe_targets;
CREATE INDEX probe_target_events_url ON probe_target_events(url,at);
