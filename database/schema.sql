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

COMMIT;
