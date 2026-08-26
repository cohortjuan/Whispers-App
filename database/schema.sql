-- whispers app db schema
-- runs automatically when the docker container first spins up,
-- or run it yourself with: psql "$DATABASE_URL" -f database/schema.sql

BEGIN;

-- ---------------------------------------------------------------------
-- families: the actual sharing boundary. every `people` row and every
-- login (`users` row) belongs to exactly one family -- that's what scopes
-- who can see what (see backend/src/middleware/requireAuth.js and the
-- family_id filters throughout backend/src/routes/*.js). people join a
-- family either by creating one at signup or by redeeming an `invites`
-- code from an existing member (below).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS families (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- people: any family member who can have clips and relationships
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id           SERIAL PRIMARY KEY,
  family_id    INTEGER REFERENCES families(id) ON DELETE CASCADE,
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
-- row -- a login answers "is someone authenticated, and which family are
-- they in", not "which person are they". family_id is what scopes every
-- people/clips/relationships query to just this user's family.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     SERIAL PRIMARY KEY,
  family_id              INTEGER REFERENCES families(id) ON DELETE CASCADE,
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

-- ---------------------------------------------------------------------
-- invites: how someone joins an existing family instead of starting a new
-- one. Deliberately not a permanent per-family code -- a single reusable
-- code is a standing secret that leaks forever once shared once. Each row
-- here is single-use (used_at gets set the moment it's redeemed, checked
-- in backend/src/routes/auth.js before letting a second redemption
-- through) and expires on its own. email is optional: set, it locks the
-- code to that one address (checked case-insensitively against the
-- normalized email doing the redeeming); NULL, it's redeemable by
-- whoever has the code first, still exactly once.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id           SERIAL PRIMARY KEY,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  code         VARCHAR(20) NOT NULL UNIQUE,
  email        VARCHAR(255),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_family_id ON invites(family_id);

-- ---------------------------------------------------------------------
-- family_id backfill: people/users predate the families table above. A
-- brand-new database has zero rows in either, so this block is a no-op
-- there. Against a database that already has data (an existing local
-- checkout, or a hosted db this got deployed to before), it groups
-- whatever's already there into one catch-all family instead of leaving
-- those rows with a NULL family_id, which the NOT NULL constraints below
-- would otherwise reject outright.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  legacy_family_id INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM people WHERE family_id IS NULL)
     OR EXISTS (SELECT 1 FROM users WHERE family_id IS NULL) THEN
    INSERT INTO families (name) VALUES ('My Family') RETURNING id INTO legacy_family_id;
    UPDATE people SET family_id = legacy_family_id WHERE family_id IS NULL;
    UPDATE users SET family_id = legacy_family_id WHERE family_id IS NULL;
  END IF;
END $$;

ALTER TABLE people ALTER COLUMN family_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_people_family_id ON people(family_id);
CREATE INDEX IF NOT EXISTS idx_users_family_id ON users(family_id);

COMMIT;
