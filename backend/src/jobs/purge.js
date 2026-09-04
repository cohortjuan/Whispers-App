import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { TRASH_RETENTION_DAYS } from '../lib/retention.js';


// mirrors isOwnUploadedFile/deleteUploadedPhoto in routes/people.js -- a
// photo_url can still be a plain external link someone typed in (predates
// upload support), never touch disk for that
function unlinkIfOwnFile(filename) {
  if (!filename || /^https?:\/\//i.test(filename)) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(filename)), () => {});
}

// hard-deletes anyone trashed 30+ days ago (routes/people.js's DELETE /:id),
// plus their clip files and photo off disk. File paths are read out BEFORE
// the db rows are deleted -- same order every other hard-delete in this
// codebase uses, and for the same reason: once the row's gone there's no
// way to know which files were even theirs.
export async function purgeTrashedPeople() {
  const peopleResult = await pool.query(
    `SELECT id, photo_url FROM people
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)`,
    [TRASH_RETENTION_DAYS]
  );
  if (peopleResult.rows.length === 0) return { purged: 0 };

  const ids = peopleResult.rows.map((r) => r.id);
  const clipsResult = await pool.query('SELECT file_path FROM clips WHERE person_id = ANY($1)', [ids]);

  await pool.query('DELETE FROM people WHERE id = ANY($1)', [ids]); // cascades clips + relationships

  for (const row of clipsResult.rows) unlinkIfOwnFile(row.file_path);
  for (const row of peopleResult.rows) unlinkIfOwnFile(row.photo_url);

  return { purged: ids.length };
}

// hard-deletes any clip trashed 30+ days ago (routes/clips.js's DELETE /:id)
// and unlinks its file. Same read-paths-then-delete-then-unlink order as
// above: once the row is gone there's nothing left that knows which file on
// disk belonged to it, so it would leak forever.
//
// Clips whose PERSON gets purged are already handled by purgeTrashedPeople
// above -- that reads every one of their clips' file paths (trashed or not)
// before the cascade removes the rows.
export async function purgeTrashedClips() {
  const result = await pool.query(
    `DELETE FROM clips
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)
     RETURNING file_path`,
    [TRASH_RETENTION_DAYS]
  );
  for (const row of result.rows) unlinkIfOwnFile(row.file_path);
  return { purged: result.rows.length };
}

// hard-deletes any login soft-deleted 30+ days ago (routes/auth.js's
// DELETE /me). No files of its own to clean up -- a users row is just a
// login, not a person (see the users table's own comment in schema.sql) --
// and no family/people/clips data is touched, only the login itself.
//
// DELIBERATE, not an oversight: if the LAST login in a family is purged,
// that family's people, clips and audio files are left behind with nobody
// able to reach them. Deleting them automatically is the alternative, and
// it's the wrong trade for this app -- the whole point here is recordings
// of people who may not be around to re-record, and "the last relative
// closed their account" is not a good enough reason to destroy the only
// copy of a grandparent's voice. Someone can always be invited back into
// that family by an admin re-pointing a login at it.
//
// The cost of that choice is real and worth knowing: orphaned uploads stay
// on the Render disk forever and it only grows. If that ever needs
// reclaiming, do it as a reviewed manual cleanup with a backup taken
// first -- not on a timer.
export async function purgeDeletedUsers() {
  const result = await pool.query(
    `DELETE FROM users
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)
     RETURNING id`,
    [TRASH_RETENTION_DAYS]
  );
  return { purged: result.rows.length };
}
