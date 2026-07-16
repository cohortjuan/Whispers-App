import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool, queryOrNotFound } from '../db/pool.js';
import { UPLOAD_DIR } from '../middleware/upload.js';

export const peopleRouter = Router();

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

// POST /api/people - add a new family member
peopleRouter.post('/', async (req, res, next) => {
  try {
    const { errors, values } = validatePersonBody(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    const { first_name, last_name, nickname, birth_date, death_date, bio, photo_url } = values;
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
        photo_url || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/people/:id - edit an existing person, only sends fields that changed.
// builds the SET clause from whatever was actually sent instead of a
// select-then-merge-then-update-everything round trip
peopleRouter.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { errors, values } = validatePersonBody(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    const sets = ['updated_at = now()'];
    const params = [];
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const clean = typeof value === 'string' && (field === 'first_name' || field === 'last_name') ? value.trim() : (value || null);
      params.push(clean);
      sets.push(`${field} = $${params.length}`);
    }
    params.push(id);

    const person = await queryOrNotFound(
      res,
      `UPDATE people SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
      `person ${id} not found`
    );
    if (!person) return;
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/people/:id - removes the person (relationships + clips cascade in the db),
// then cleans up their audio files on disk since postgres doesn't know about those
peopleRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const clipsResult = await pool.query('SELECT file_path FROM clips WHERE person_id = $1', [id]);

    const deleted = await queryOrNotFound(res, 'DELETE FROM people WHERE id = $1 RETURNING id', [id], `person ${id} not found`);
    if (!deleted) return;

    // best effort file cleanup, don't block the response on it
    for (const row of clipsResult.rows) {
      const absolutePath = path.join(UPLOAD_DIR, path.basename(row.file_path));
      fs.unlink(absolutePath, () => {});
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
