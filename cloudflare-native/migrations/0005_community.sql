CREATE TABLE IF NOT EXISTS support_grants(session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS help_videos(id INTEGER PRIMARY KEY,topic TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,video_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS legal_requests(id TEXT PRIMARY KEY,kind TEXT NOT NULL,encrypted_payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'new',created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS legal_actions(id TEXT PRIMARY KEY,request_id TEXT REFERENCES legal_requests(id),action TEXT NOT NULL,notes TEXT NOT NULL,created_at INTEGER NOT NULL);
