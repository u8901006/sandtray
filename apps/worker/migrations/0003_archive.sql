CREATE TABLE IF NOT EXISTS scene_archive (
 clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 source_room_id TEXT NOT NULL, version_id TEXT NOT NULL, scene_revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(clinic_id,scene_id,version_id)
);
CREATE INDEX IF NOT EXISTS scene_archive_owner ON scene_archive(clinic_id,owner_id,expires_at);