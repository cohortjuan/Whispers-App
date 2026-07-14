import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
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
    const result = await pool.query(
      `SELECT p.*,
              COUNT(c.id)::int AS clip_count
       FROM people p
       LEFT JOIN clips c ON c.person_id = p.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `person ${id} not found` });
    }
    res.json(result.rows[0]);
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

// PUT /api/people/:id - edit an existing person, only sends fields that changed
peopleRouter.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { errors, values } = validatePersonBody(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    const existing = await pool.query('SELECT * FROM people WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `person ${id} not found` });
    }
    const current = existing.rows[0];

    // fall back to the current value for anything that wasn't sent
    const merged = {
      first_name: values.first_name !== undefined ? values.first_name.trim() : current.first_name,
      last_name: values.last_name !== undefined ? values.last_name.trim() : current.last_name,
      nickname: values.nickname !== undefined ? values.nickname : current.nickname,
      birth_date: values.birth_date !== undefined ? values.birth_date : current.birth_date,
      death_date: values.death_date !== undefined ? values.death_date : current.death_date,
      bio: values.bio !== undefined ? values.bio : current.bio,
      photo_url: values.photo_url !== undefined ? values.photo_url : current.photo_url,
    };

    const result = await pool.query(
      `UPDATE people
       SET first_name = $1, last_name = $2, nickname = $3, birth_date = $4,
           death_date = $5, bio = $6, photo_url = $7, updated_at = now()
       WHERE id = $8
       RETURNING *`,
      [
        merged.first_name,
        merged.last_name,
        merged.nickname || null,
        merged.birth_date || null,
        merged.death_date || null,
        merged.bio || null,
        merged.photo_url || null,
        id,
      ]
    );
    res.json(result.rows[0]);
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

    const result = await pool.query('DELETE FROM people WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `person ${id} not found` });
    }

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
