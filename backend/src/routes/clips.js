import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool, queryOrNotFound } from '../db/pool.js';
import { upload, UPLOAD_DIR } from '../middleware/upload.js';
import { TRASH_RETENTION_DAYS } from '../lib/retention.js';

export const clipsRouter = Router();

// GET /api/clips - only clips belonging to people in the caller's own family
// GET /api/clips?person_id=5
clipsRouter.get('/', async (req, res, next) => {
  try {
    const { person_id } = req.query;

    const baseQuery = `
      SELECT c.*, p.first_name, p.last_name
      FROM clips c
      JOIN people p ON p.id = c.person_id
      WHERE p.family_id = $1 AND p.deleted_at IS NULL AND c.deleted_at IS NULL
    `;

    if (person_id) {
      const result = await pool.query(`${baseQuery} AND c.person_id = $2 ORDER BY c.created_at DESC`, [
        req.user.family.id,
        person_id,
      ]);
      return res.json(result.rows);
    }

    const result = await pool.query(`${baseQuery} ORDER BY c.created_at DESC`, [req.user.family.id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/trash - clips in the trash, newest first, with the same
// purge_at the people trash returns so the UI can say when it's really gone.
// MUST stay above GET /:id -- express matches in registration order, so
// below it "trash" would be swallowed as an :id and never reach this.
clipsRouter.get('/trash', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.first_name, p.last_name,
              c.deleted_at + make_interval(days => $2) AS purge_at
       FROM clips c
       JOIN people p ON p.id = c.person_id
       WHERE p.family_id = $1 AND c.deleted_at IS NOT NULL
       ORDER BY c.deleted_at DESC`,
      [req.user.family.id, TRASH_RETENTION_DAYS]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/:id - scoped to the caller's own family, same 404 whether
// the clip doesn't exist or just belongs to a different family
clipsRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const clip = await queryOrNotFound(
      res,
      `SELECT c.*, p.first_name, p.last_name
       FROM clips c
       JOIN people p ON p.id = c.person_id
       WHERE c.id = $1 AND p.family_id = $2 AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [id, req.user.family.id],
      `clip ${id} not found`
    );
    if (!clip) return;
    res.json(clip);
  } catch (err) {
    next(err);
  }
});

// POST /api/clips - multipart form: file + person_id, title, description, recorded_date, media_type
// multer already saved the file to disk by the time this handler runs, we just record it
clipsRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { person_id, title, description, recorded_date, media_type } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'an audio or video file is required (field name: file)' });
    }
    if (!person_id || !title || !title.trim()) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'person_id and title are required' });
    }
    if (media_type !== undefined && media_type !== 'audio' && media_type !== 'video') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "media_type must be 'audio' or 'video'" });
    }

    const personCheck = await pool.query('SELECT id FROM people WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL', [
      person_id,
      req.user.family.id,
    ]);
    if (personCheck.rows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: `person ${person_id} not found` });
    }

    const result = await pool.query(
      `INSERT INTO clips
         (person_id, title, description, file_path, original_filename, mime_type, file_size_bytes, media_type, recorded_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        person_id,
        title.trim(),
        description || null,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        media_type || 'audio',
        recorded_date || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // clean up the uploaded file if we blew up after it was already saved
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// PUT /api/clips/:id - just the metadata, not swapping out the file itself.
// builds the SET clause from whatever was actually sent instead of a
// select-then-merge-then-update-everything round trip
clipsRouter.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, recorded_date } = req.body;

    if (title !== undefined && !title.trim()) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }

    const values = {
      title: title?.trim(),
      description,
      recorded_date: recorded_date === undefined ? undefined : (recorded_date || null),
    };
    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'nothing to update' });
    }
    params.push(id, req.user.family.id);

    // subquery instead of a family_id column on clips itself -- a clip's
    // family is always whichever family its person belongs to, so scoping
    // through that join is the same check people.js and the GET routes
    // above already use
    const clip = await queryOrNotFound(
      res,
      `UPDATE clips SET ${sets.join(', ')}
       WHERE id = $${params.length - 1}
         AND deleted_at IS NULL
         AND person_id IN (SELECT id FROM people WHERE family_id = $${params.length} AND deleted_at IS NULL)
       RETURNING *`,
      params,
      `clip ${id} not found`
    );
    if (!clip) return;
    res.json(clip);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clips/:id - moves the clip to the trash rather than destroying
// it. A recording is the one thing in this app that genuinely cannot be
// recreated, so it now gets the same grace period a person does: the row
// stays, the file stays on disk, and jobs/purge.js does the real deletion
// after TRASH_RETENTION_DAYS. Restorable via POST /:id/restore until then,
// or DELETE /:id/permanent to skip the wait deliberately.
clipsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const trashed = await queryOrNotFound(
      res,
      `UPDATE clips SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL
         AND person_id IN (SELECT id FROM people WHERE family_id = $2)
       RETURNING id, title, deleted_at`,
      [id, req.user.family.id],
      `clip ${id} not found`
    );
    if (!trashed) return;
    res.json(trashed);
  } catch (err) {
    next(err);
  }
});

// POST /api/clips/:id/restore - pulls a clip back out of the trash, but only
// inside the retention window. Same reasoning as people.js's restore: the
// purge job runs on an interval rather than exactly at the 30-day mark, so
// without this check a restore in that gap could resurrect something already
// logically expired.
clipsRouter.post('/:id/restore', async (req, res, next) => {
  try {
    const { id } = req.params;
    const clip = await queryOrNotFound(
      res,
      `UPDATE clips SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
         AND deleted_at > now() - make_interval(days => $3)
         AND person_id IN (SELECT id FROM people WHERE family_id = $2)
       RETURNING *`,
      [id, req.user.family.id, TRASH_RETENTION_DAYS],
      `clip ${id} not found in trash`
    );
    if (!clip) return;
    res.json(clip);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clips/:id/permanent - "delete forever now", skipping the rest
// of the wait. Only works on a clip already in the trash, so this is a way
// to go faster, not a second way to destroy something in one step.
clipsRouter.delete('/:id/permanent', async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await queryOrNotFound(
      res,
      `DELETE FROM clips
       WHERE id = $1 AND deleted_at IS NOT NULL
         AND person_id IN (SELECT id FROM people WHERE family_id = $2)
       RETURNING file_path`,
      [id, req.user.family.id],
      `clip ${id} not found in trash`
    );
    if (!deleted) return;

    const absolutePath = path.join(UPLOAD_DIR, path.basename(deleted.file_path));
    fs.unlink(absolutePath, () => {});

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
