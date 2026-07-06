-- Hosted Survey Roster Matcher schema.
-- Used by the Render/Postgres runtime server and the SQLite-to-Postgres
-- migration bridge.

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expires
  ON app_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS roster_children (
  roster_child_id TEXT PRIMARY KEY,
  roster_file TEXT NOT NULL,
  school_raw TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  forename_raw TEXT NOT NULL,
  surname_raw TEXT NOT NULL,
  dob_iso TEXT NOT NULL,
  birth_month TEXT NOT NULL,
  birth_year TEXT NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_roster_children_school
  ON roster_children(school_raw);

CREATE TABLE IF NOT EXISTS survey_responses (
  response_id TEXT PRIMARY KEY,
  survey_row_index INTEGER NOT NULL,
  entered_forename_raw TEXT NOT NULL,
  entered_school_raw TEXT NOT NULL,
  birth_month_year TEXT NOT NULL,
  progress NUMERIC NOT NULL,
  finished TEXT NOT NULL,
  response_class TEXT NOT NULL,
  recorded_date_raw TEXT NOT NULL,
  dedupe_group_key TEXT NOT NULL,
  dedupe_decision TEXT NOT NULL,
  duplicate_response_classification TEXT NOT NULL,
  manual_identifier_decision TEXT NOT NULL,
  imported_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS survey_response_full_rows (
  response_id TEXT PRIMARY KEY REFERENCES survey_responses(response_id) ON DELETE CASCADE,
  raw_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  response_id TEXT NOT NULL REFERENCES survey_responses(response_id) ON DELETE CASCADE,
  candidate_rank INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  preselected TEXT NOT NULL,
  score NUMERIC NOT NULL,
  top_gap NUMERIC NOT NULL,
  school_score NUMERIC NOT NULL,
  name_score NUMERIC NOT NULL,
  dob_status TEXT NOT NULL,
  reason_codes TEXT NOT NULL,
  roster_child_id TEXT NOT NULL REFERENCES roster_children(roster_child_id),
  roster_forename TEXT NOT NULL,
  roster_surname TEXT NOT NULL,
  roster_school TEXT NOT NULL,
  roster_birth_month_year TEXT NOT NULL,
  roster_dob_iso TEXT NOT NULL,
  PRIMARY KEY (response_id, candidate_rank)
);

CREATE INDEX IF NOT EXISTS idx_candidates_roster_child
  ON candidates(roster_child_id);

CREATE TABLE IF NOT EXISTS decisions (
  id BIGSERIAL PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES survey_responses(response_id),
  roster_child_id TEXT REFERENCES roster_children(roster_child_id),
  action TEXT NOT NULL CHECK (action IN ('matched', 'deferred', 'no_match', 'ambiguous', 'duplicate')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  undone_at TIMESTAMPTZ,
  undone_by TEXT
);

-- First-write-wins constraints for concurrent hosted use.
CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_one_active_response
  ON decisions(response_id)
  WHERE undone_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_one_active_matched_child
  ON decisions(roster_child_id)
  WHERE undone_at IS NULL
    AND action = 'matched'
    AND roster_child_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decisions_created_at
  ON decisions(created_at DESC);

CREATE TABLE IF NOT EXISTS roster_additions (
  roster_child_id TEXT PRIMARY KEY REFERENCES roster_children(roster_child_id),
  school_raw TEXT NOT NULL,
  forename_raw TEXT NOT NULL,
  surname_raw TEXT NOT NULL,
  dob_iso TEXT NOT NULL,
  birth_month TEXT NOT NULL,
  birth_year TEXT NOT NULL,
  sex TEXT,
  upn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id BIGSERIAL PRIMARY KEY,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by TEXT NOT NULL,
  raw_upload_name TEXT NOT NULL,
  raw_upload_path TEXT NOT NULL,
  backup_path TEXT,
  raw_rows INTEGER,
  new_response_rows INTEGER,
  skipped_existing_responses INTEGER,
  candidate_rows INTEGER,
  status TEXT NOT NULL CHECK (status IN ('completed', 'completed_with_warnings', 'failed')),
  warnings_json JSONB,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL,
  response_id TEXT,
  roster_child_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_response
  ON audit_events(response_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_roster_child
  ON audit_events(roster_child_id);
