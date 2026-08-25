-- whispers app db schema
-- runs automatically when the docker container first spins up,
-- or run it yourself with: psql "$DATABASE_URL" -f database/schema.sql

BEGIN;

-- ---------------------------------------------------------------------
-- people: any family member who can have clips and relationships
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id           SERIAL PRIMARY KEY,
  first_name   VARCHAR(100) NOT NULL,
  last_name    VARCHAR(100) NOT NULL,
  nickname     VARCHAR(100),
  birth_date   DATE,
  death_date   DATE,
  bio          TEXT,
  photo_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT death_after_birth CHECK (death_date IS NULL OR birth_date IS NULL OR death_date >= birth_date)
);

-- ---------------------------------------------------------------------
-- relationships: directed edges between two people
-- type = 'parent' -> person_id is the PARENT of related_person_id
-- type = 'spouse' -> symmetric, we only store it once per couple
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relationships (
  id                 SERIAL PRIMARY KEY,
  person_id          INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  related_person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_type  VARCHAR(20) NOT NULL CHECK (relationship_type IN ('parent', 'spouse')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_relationship CHECK (person_id <> related_person_id),
  CONSTRAINT unique_relationship UNIQUE (person_id, related_person_id, relationship_type)
);

-- ---------------------------------------------------------------------
-- clips: the actual audio (and later video) recordings, one per row
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clips (
  id                  SERIAL PRIMARY KEY,
  person_id           INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  file_path           TEXT NOT NULL,       -- just the filename, lives under backend/uploads
  original_filename   TEXT,
  mime_type           VARCHAR(100),
  file_size_bytes     INTEGER,
  media_type          VARCHAR(10) NOT NULL DEFAULT 'audio' CHECK (media_type IN ('audio', 'video')),
  recorded_date       DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- indexes so the family tree / clip lookups don't get slow as this grows
CREATE INDEX IF NOT EXISTS idx_relationships_person_id ON relationships(person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_related_person_id ON relationships(related_person_id);
CREATE INDEX IF NOT EXISTS idx_clips_person_id ON clips(person_id);

-- ---------------------------------------------------------------------
-- users: login accounts. deliberately NOT the same thing as a `people`
-- row -- everyone who logs in shares the same family tree data (no
-- owner_id/family_id anywhere, no per-user data ownership), so a login
-- only answers "is someone authenticated", not "which person are they"
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     SERIAL PRIMARY KEY,
  -- always stored lowercased and compared lowercased in queries (see
  -- backend/src/routes/auth.js normalizeEmail()) instead of relying on
  -- the citext extension -- this schema doesn't use any extensions
  -- elsewhere and hosted postgres providers vary on what they allow you
  -- to CREATE EXTENSION, so plain VARCHAR + app-level normalization is
  -- the safer default here
  email                  VARCHAR(255) NOT NULL UNIQUE,
  password_hash          TEXT NOT NULL,
  display_name           VARCHAR(200) NOT NULL,
  -- account lockout bookkeeping: consecutive bad login attempts and how
  -- long the account is locked for, independent of which IP is trying.
  -- reset to 0 / NULL on a successful login
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- sessions: server-validated login sessions. opaque random tokens, not
-- signed JWTs, so a session can be revoked immediately (logout, or an
-- admin doing it by hand) just by deleting the row -- a signed JWT would
-- stay valid until it expired no matter what the server did
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- sha256 of the raw session token. the raw token only ever lives in the
  -- httpOnly cookie -- same principle as never storing a plaintext
  -- password, a leaked users/sessions table alone shouldn't be enough to
  -- forge a session
  token_hash   TEXT NOT NULL UNIQUE,
  -- double-submit csrf token tied to this specific session row (rather
  -- than a bare stateless double-submit) -- see backend/src/middleware/csrf.js
  csrf_token   TEXT NOT NULL,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token_hash lookups are covered by the UNIQUE constraint's own index above;
-- user_id isn't unique, so it needs its own index for session-cleanup queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

COMMIT;
