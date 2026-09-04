import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { pool, queryOrNotFound } from '../db/pool.js';
import { UPLOAD_DIR, photoUpload, isRealImage } from '../middleware/upload.js';
// how long a trashed person stays recoverable before jobs/purge.js hard-deletes
// them for good -- also used by GET /trash's purge_at and POST /:id/restore's
// window check below. Shared with the purge job and auth.js's account-restore
// window so the three can't drift apart (see lib/retention.js).
import { TRASH_RETENTION_DAYS } from '../lib/retention.js';

export const peopleRouter = Router();

// A hard ceiling on the free tier's single shared tree. Chosen generously
// enough to cover a genuinely large extended family (grandparents, parents,
// their siblings and spouses, cousins, kids -- 50 comfortably fits most real
// families) without being effectively unlimited. This is the free-tier cap;
// a paid tier raising or removing it is a future change, not implemented
// here -- there's no billing/plan concept in this app yet, so for now it's
// one constant, not a per-account setting.
const MAX_PEOPLE = 50;

// shared validation for create + update, partial=true skips required-field checks
// on fields that weren't sent (used for PUT so you can update just one field)
function validatePersonBody(body, { partial = false } = {}) {
  const errors = [];
  const { first_name, last_name, suffix, nickname, birth_date, death_date, bio, photo_url } = body;

  if (!partial || first_name !== undefined) {
    if (!first_name || typeof first_name !== 'string' || !first_name.trim()) {
      errors.push('first_name is required');
    }
  }
  if (!partial || last_name !== undefined) {
    if (!last_name || typeof last_name !== 'string' || !last_name.trim()) {
      errors.push('last_name is required');
    }
  }
  if (suffix && suffix.length > 10) {
    errors.push('suffix must be 10 characters or fewer');
  }
  if (birth_date && Number.isNaN(Date.parse(birth_date))) {
    errors.push('birth_date must be a valid date');
  }
  if (death_date && Number.isNaN(Date.parse(death_date))) {
    errors.push('death_date must be a valid date');
  }

  return {
    errors,
    values: { first_name, last_name, suffix, nickname, birth_date, death_date, bio, photo_url },
  };
}

// A photo_url we generated ourselves is just a bare filename (see
// photoUpload's storage config) -- never touch disk for anything that looks
// like a URL someone typed in instead, that's not our file to delete.
function isOwnUploadedFile(value) {
  return Boolean(value) && !/^https?:\/\//i.test(value);
}

function deleteUploadedPhoto(filename) {
  if (!isOwnUploadedFile(filename)) return;
  const absolutePath = path.join(UPLOAD_DIR, path.basename(filename));
  fs.unlink(absolutePath, () => {});
}

// Runs after multer has already written the file to disk -- multer's own
// fileFilter only saw the client-reported mimetype, which is just a claim.
// This checks the actual bytes before the row referencing it is ever
// created, so a mislabeled non-image can't slip through just because it was
// renamed to end in .jpg.
function verifyRealImage(req, res) {
  if (!req.file) return true;
  const buffer = fs.readFileSync(req.file.path);
  if (!isRealImage(buffer)) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: 'that file is not a valid JPEG, PNG, or WebP image' });
    return false;
  }
  return true;
}

// GET /api/people - everybody in the caller's own family, sorted by last name.
// excludes trashed people -- see GET /trash below for those
peopleRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id
       WHERE p.family_id = $1 AND p.deleted_at IS NULL
       GROUP BY p.id
       ORDER BY p.last_name, p.first_name`,
      [req.user.family.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/people/trash - trashed people in the caller's family, most
// recently trashed first, with when they'll be gone for good. Registered
// before GET /:id on purpose -- express matches path templates in
// registration order, and /:id would otherwise swallow "/trash" as if it
// were an id (and then choke comparing the literal string "trash" against
// an INTEGER column).
peopleRouter.get('/trash', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count,
              p.deleted_at + make_interval(days => $2) AS purge_at
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id AND c.deleted_at IS NULL
       WHERE p.family_id = $1 AND p.deleted_at IS NOT NULL
       GROUP BY p.id
       ORDER BY p.deleted_at DESC`,
      [req.user.family.id, TRASH_RETENTION_DAYS]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/people/:id - one person, with how many clips they have. Scoped to
// the caller's own family_id, not just the id -- otherwise anyone logged in
// to any family could read another family's person by guessing/incrementing
// an id, same 404 either way so it doesn't even reveal that the id exists.
// Excludes trashed people -- a trashed person only shows up through the
// trash-specific routes below (GET /trash, POST /:id/restore,
// DELETE /:id/permanent, GET /:id/export).
peopleRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const person = await queryOrNotFound(
      res,
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id
       WHERE p.id = $1 AND p.family_id = $2 AND p.deleted_at IS NULL
       GROUP BY p.id`,
      [id, req.user.family.id],
      `person ${id} not found`
    );
    if (!person) return;
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// POST /api/people - add a new family member.
// multipart form: optional file field "photo", plus the usual text fields.
peopleRouter.post('/', photoUpload.single('photo'), async (req, res, next) => {
  try {
    if (!verifyRealImage(req, res)) return;

    const { errors, values } = validatePersonBody(req.body);
    if (errors.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: errors.join(', ') });
    }

    // trashed people don't count toward the cap -- trashing someone should
    // actually free up a slot, not just hide them while still counting
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM people WHERE family_id = $1 AND deleted_at IS NULL',
      [req.user.family.id]
    );
    if (countResult.rows[0].count >= MAX_PEOPLE) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        error: `this family tree is at its ${MAX_PEOPLE}-person limit on the free plan. higher limits are coming with paid plans.`,
      });
    }

    const { first_name, last_name, suffix, nickname, birth_date, death_date, bio, photo_url } = values;
    // An uploaded file takes priority over a typed-in photo_url -- if both
    // somehow arrived on the same request, the file is the more deliberate
    // action (someone chose and confirmed a specific file).
    const finalPhotoUrl = req.file ? req.file.filename : photo_url || null;

    const result = await pool.query(
      `INSERT INTO people (family_id, first_name, last_name, suffix, nickname, birth_date, death_date, bio, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.family.id,
        first_name.trim(),
        last_name.trim(),
        suffix?.trim() || null,
        nickname || null,
        birth_date || null,
        death_date || null,
        bio || null,
        finalPhotoUrl,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// PUT /api/people/:id - edit an existing person, only sends fields that changed.
// builds the SET clause from whatever was actually sent instead of a
// select-then-merge-then-update-everything round trip
peopleRouter.put('/:id', photoUpload.single('photo'), async (req, res, next) => {
  try {
    if (!verifyRealImage(req, res)) return;

    const { id } = req.params;
    const { errors, values } = validatePersonBody(req.body, { partial: true });
    if (errors.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: errors.join(', ') });
    }

    // A new file overrides whatever photo_url was also sent, same priority
    // rule as create.
    if (req.file) {
      values.photo_url = req.file.filename;
    }

    const sets = ['updated_at = now()'];
    const params = [];
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const clean = typeof value === 'string' && (field === 'first_name' || field === 'last_name') ? value.trim() : (value || null);
      params.push(clean);
      sets.push(`${field} = $${params.length}`);
    }

    if (sets.length === 1 && !req.file) {
      // just "updated_at" queued and no file either -- nothing real to save
      return res.status(400).json({ error: 'nothing to update' });
    }

    // Grab the old photo before overwriting it, so a replaced file doesn't
    // just orphan the previous one on disk forever.
    const previous = req.file
      ? await pool.query('SELECT photo_url FROM people WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL', [id, req.user.family.id])
      : null;

    params.push(id, req.user.family.id);

    // can't edit a trashed person -- restore them first (POST /:id/restore)
    const person = await queryOrNotFound(
      res,
      `UPDATE people SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND family_id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
      `person ${id} not found`
    );
    if (!person) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return;
    }

    if (req.file && previous?.rows[0]?.photo_url) {
      deleteUploadedPhoto(previous.rows[0].photo_url);
    }

    res.json(person);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// DELETE /api/people/:id - moves the person to the trash (deleted_at = now())
// instead of deleting anything for real. Their clips/relationships/files are
// all left completely alone -- nothing to clean up here, unlike the old hard
// delete. They're recoverable via POST /:id/restore for TRASH_RETENTION_DAYS,
// after which jobs/purge.js hard-deletes them for good (see that file for the
// actual file cleanup). DELETE /:id/permanent below skips the wait.
peopleRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const person = await queryOrNotFound(
      res,
      `UPDATE people SET deleted_at = now() WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL
       RETURNING id, first_name, last_name, deleted_at`,
      [id, req.user.family.id],
      `person ${id} not found`
    );
    if (!person) return;
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// POST /api/people/:id/restore - pulls a person back out of the trash, only
// while still inside the retention window. The window check here (not just
// "still present in the table") matters because jobs/purge.js only runs on
// an interval, not instantly at the 30-day mark -- without it, a restore
// attempt in that small gap could resurrect a person who's logically already
// past their grace period, just not yet physically purged.
peopleRouter.post('/:id/restore', async (req, res, next) => {
  try {
    const { id } = req.params;
    const person = await queryOrNotFound(
      res,
      `UPDATE people SET deleted_at = NULL WHERE id = $1 AND family_id = $2
         AND deleted_at IS NOT NULL AND deleted_at > now() - make_interval(days => $3)
       RETURNING *`,
      [id, req.user.family.id, TRASH_RETENTION_DAYS],
      `person ${id} not found in trash`
    );
    if (!person) return;
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/people/:id/permanent - "delete forever now" from the trash,
// skipping the rest of the wait. Only works on someone already trashed --
// everything has to go through the trash first (DELETE /:id above), this
// just gives a way to skip ahead instead of a second way to get there. Same
// select-file-paths-first-then-delete-then-unlink order the old hard delete
// used, and jobs/purge.js's automatic version uses too.
peopleRouter.delete('/:id/permanent', async (req, res, next) => {
  try {
    const { id } = req.params;

    const clipsResult = await pool.query('SELECT file_path FROM clips WHERE person_id = $1', [id]);

    const deleted = await queryOrNotFound(
      res,
      'DELETE FROM people WHERE id = $1 AND family_id = $2 AND deleted_at IS NOT NULL RETURNING id, photo_url',
      [id, req.user.family.id],
      `person ${id} not found in trash`
    );
    if (!deleted) return;

    // best effort file cleanup, don't block the response on it
    for (const row of clipsResult.rows) {
      const absolutePath = path.join(UPLOAD_DIR, path.basename(row.file_path));
      fs.unlink(absolutePath, () => {});
    }
    deleteUploadedPhoto(deleted.photo_url);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/people/:id/export - zips up every clip file belonging to this
// person, plus a manifest, as a "back this up before it's gone" download.
// Deliberately has NO deleted_at filter on the person lookup -- this has to
// keep working on a currently-trashed person too, otherwise the 30-day
// retention window isn't actually a real chance to grab a copy, just a
// number.
peopleRouter.get('/:id/export', async (req, res, next) => {
  try {
    const { id } = req.params;
    const person = await queryOrNotFound(
      res,
      'SELECT id, first_name, last_name FROM people WHERE id = $1 AND family_id = $2',
      [id, req.user.family.id],
      `person ${id} not found`
    );
    if (!person) return;

    const clipsResult = await pool.query(
      // individually-trashed clips are left out: they have their own trash
      // entry to restore from, and including them here would make the zip
      // disagree with the "N clips" count the trash screen shows
      `SELECT file_path, title, media_type, recorded_date, created_at
       FROM clips WHERE person_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id]
    );
    if (clipsResult.rows.length === 0) {
      return res.status(404).json({ error: 'this person has no clips to export' });
    }

    const slug = `${person.first_name}-${person.last_name}`.replace(/[^a-z0-9-]+/gi, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-clips.zip"`);

    const archive = archiver('zip');
    archive.on('warning', (err) => {
      // ENOENT here means one clip's file was missing on disk -- skip it
      // rather than failing the whole export over one bad file
      if (err.code !== 'ENOENT') archive.emit('error', err);
    });
    archive.on('error', (err) => {
      // once archive.pipe(res) has flushed any bytes, a normal
      // res.status().json() error response is no longer possible -- only
      // fall through to the error handler if nothing's been sent yet
      if (!res.headersSent) return next(err);
      console.error('export zip stream failed after headers were sent:', err.message);
      res.destroy();
    });
    archive.pipe(res);

    const manifestLines = [`clips for ${person.first_name} ${person.last_name}`, ''];
    clipsResult.rows.forEach((clip, i) => {
      const ext = path.extname(clip.file_path) || '';
      const safeTitle = (clip.title || 'clip').replace(/[^a-z0-9-_ ]+/gi, '_');
      const entryName = `${i + 1}-${safeTitle}${ext}`;
      archive.file(path.join(UPLOAD_DIR, path.basename(clip.file_path)), { name: entryName });
      manifestLines.push(`${entryName} -- ${clip.title}${clip.recorded_date ? ` (recorded ${clip.recorded_date})` : ''}`);
    });
    archive.append(manifestLines.join('\n'), { name: 'manifest.txt' });

    archive.finalize();
  } catch (err) {
    next(err);
  }
});
