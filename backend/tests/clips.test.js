import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/db/pool.js', () => {
  const pool = { query: vi.fn() };
  const queryOrNotFound = async (res, query, params, notFoundMessage) => {
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      res.status(404).json({ error: notFoundMessage });
      return null;
    }
    return result.rows[0];
  };
  return { pool, queryOrNotFound };
});

const { pool } = await import('../src/db/pool.js');
const { clipsRouter } = await import('../src/routes/clips.js');

const FAMILY_ID = 7;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, family: { id: FAMILY_ID } };
    next();
  });
  app.use('/api/clips', clipsRouter);
  return app;
}

beforeEach(() => {
  pool.query.mockReset();
});

describe('GET /api/clips', () => {
  it('excludes clips belonging to a trashed person, both listing branches', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    await request(app).get('/api/clips');
    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');

    pool.query.mockClear();
    await request(app).get('/api/clips?person_id=42');
    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');
  });
});

describe('GET /api/clips/:id', () => {
  it('excludes a clip belonging to a trashed person', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const res = await request(app).get('/api/clips/1');

    expect(res.status).toBe(404);
    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');
  });
});

describe('POST /api/clips', () => {
  it("404s uploading a clip onto a trashed person's page", async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM people')) {
        expect(sql).toContain('deleted_at IS NULL');
        return { rows: [] }; // simulates the trashed person failing this check
      }
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/clips')
      .field('person_id', '42')
      .field('title', 'a memory')
      .attach('file', Buffer.from('fake audio bytes'), { filename: 'clip.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(404);
  });
});
