import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { upload, UPLOAD_DIR } from '../middleware/upload.js';

export const clipsRouter = Router();

// GET /api/clips
// GET /api/clips?person_id=5
clipsRouter.get('/', async (req, res, next) => {
  try {
    const { person_id } = req.query;

    const baseQuery = `
      SELECT c.*, p.first_name, p.last_name
      FROM clips c
      JOIN people p ON p.id = c.person_id
    `;

    if (person_id) {
      const result = await pool.query(`${baseQuery} WHERE c.person_id = $1 ORDER BY c.created_at DESC`, [person_id]);
      return res.json(result.rows);
    }

    const result = await pool.query(`${baseQuery} ORDER BY c.created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/:id
clipsRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.*, p.first_name, p.last_name
       FROM clips c
       JOIN people p ON p.id = c.person_id
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `clip ${id} not found` });
    }
    res.json(result.rows[0]);
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

    const personCheck = await pool.query('SELECT id FROM people WHERE id = $1', [person_id]);
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

// PUT /api/clips/:id - just the metadata, not swapping out the file itself
clipsRouter.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, recorded_date } = req.body;

    const existing = await pool.query('SELECT * FROM clips WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `clip ${id} not found` });
    }
    const current = existing.rows[0];

    if (title !== undefined && !title.trim()) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }

    const result = await pool.query(
      `UPDATE clips SET title = $1, description = $2, recorded_date = $3 WHERE id = $4 RETURNING *`,
      [
        title !== undefined ? title.trim() : current.title,
        description !== undefined ? description : current.description,
        recorded_date !== undefined ? (recorded_date || null) : current.recorded_date,
        id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clips/:id - drops the row and deletes the file off disk
clipsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM clips WHERE id = $1 RETURNING file_path', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `clip ${id} not found` });
    }

    const absolutePath = path.join(UPLOAD_DIR, path.basename(result.rows[0].file_path));
    fs.unlink(absolutePath, () => {});

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
