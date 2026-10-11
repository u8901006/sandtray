CREATE TABLE IF NOT EXISTS clinics (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS therapists (
 participant_id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id),
 issuer TEXT NOT NULL, subject TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS assignments (
 clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, participant_id TEXT NOT NULL,
 PRIMARY KEY (clinic_id, scene_id, participant_id)
);
CREATE TABLE IF NOT EXISTS scenes_index (
 clinic_id TEXT NOT NULL, scene_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
 deleted_at INTEGER, PRIMARY KEY(clinic_id,scene_id)
);
