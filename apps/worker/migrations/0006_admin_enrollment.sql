-- 2026-10-11 使用者裁定：治療師以「加入碼＋Google 登入」加入，單一診所，管理員由 therapists.is_admin 標記。
-- 系統只認 OIDC issuer＋subject；display_name 是管理員自己填的備註，不參與授權。
ALTER TABLE therapists ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE therapists ADD COLUMN display_name TEXT;
-- 加入碼只存 SHA-256；一次性（used_at）、會過期（expires_at）、可作廢（revoked_at）。
CREATE TABLE IF NOT EXISTS enrollments (
 code_hash TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), display_name TEXT NOT NULL,
 grant_admin INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 used_at INTEGER, used_by TEXT, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, clinic_id TEXT NOT NULL, at INTEGER NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT
);
