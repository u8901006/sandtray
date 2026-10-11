CREATE TABLE IF NOT EXISTS scene_versions (
 clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, version_id TEXT NOT NULL,
 scene_revision INTEGER NOT NULL, object_key TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY (clinic_id,scene_id,version_id)
);
CREATE INDEX IF NOT EXISTS scene_versions_expiry ON scene_versions(expires_at);
