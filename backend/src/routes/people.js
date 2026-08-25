import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool, queryOrNotFound } from '../db/pool.js';
import { UPLOAD_DIR, photoUpload, isRealImage } from '../middleware/upload.js';

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
  const { first_name, last_name, nickname, birth_date, death_date, bio, photo_url } = body;

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
  if (birth_date && Number.isNaN(Date.parse(birth_date))) {
    errors.push('birth_date must be a valid date');
  }
  if (death_date && Number.isNaN(Date.parse(death_date))) {
    errors.push('death_date must be a valid date');
  }

  return {
    errors,
    values: { first_name, last_name, nickname, birth_date, death_date, bio, photo_url },
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

// GET /api/people - everybody, sorted by last name
peopleRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id
       GROUP BY p.id
       ORDER BY p.last_name, p.first_name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/people/:id - one person, with how many clips they have
peopleRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const person = await queryOrNotFound(
      res,
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [id],
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

    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM people');
    if (countResult.rows[0].count >= MAX_PEOPLE) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        error: `this family tree is at its ${MAX_PEOPLE}-person limit on the free plan. higher limits are coming with paid plans.`,
      });
    }

    const { first_name, last_name, nickname, birth_date, death_date, bio, photo_url } = values;
    // An uploaded file takes priority over a typed-in photo_url -- if both
    // somehow arrived on the same request, the file is the more deliberate
    // action (someone chose and confirmed a specific file).
    const finalPhotoUrl = req.file ? req.file.filename : photo_url || null;

    const result = await pool.query(
      `INSERT INTO people (first_name, last_name, nickname, birth_date, death_date, bio, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        first_name.trim(),
        last_name.trim(),
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
      ? await pool.query('SELECT photo_url FROM people WHERE id = $1', [id])
      : null;

    params.push(id);

    const person = await queryOrNotFound(
      res,
      `UPDATE people SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
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

// DELETE /api/people/:id - removes the person (relationships + clips cascade in the db),
// then cleans up their audio files and photo on disk since postgres doesn't know about those
peopleRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const clipsResult = await pool.query('SELECT file_path FROM clips WHERE person_id = $1', [id]);

    const deleted = await queryOrNotFound(
      res,
      'DELETE FROM people WHERE id = $1 RETURNING id, photo_url',
      [id],
      `person ${id} not found`
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
