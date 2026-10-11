CREATE TABLE IF NOT EXISTS data_managers (
 clinic_id TEXT NOT NULL, participant_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(clinic_id,participant_id)
);
CREATE TABLE IF NOT EXISTS scene_tombstones (
 clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, deleted_at INTEGER NOT NULL,
 PRIMARY KEY(clinic_id,scene_id)
);
