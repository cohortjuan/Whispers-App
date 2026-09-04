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
const { relationshipsRouter } = await import('../src/routes/relationships.js');

const FAMILY_ID = 7;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, family: { id: FAMILY_ID } };
    next();
  });
  app.use('/api/relationships', relationshipsRouter);
  return app;
}

beforeEach(() => {
  pool.query.mockReset();
});

describe('GET /api/relationships', () => {
  it('excludes any relationship touching a trashed person, on either side', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    await request(app).get('/api/relationships');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('p1.deleted_at IS NULL');
    expect(sql).toContain('p2.deleted_at IS NULL');
  });
});

describe('POST /api/relationships', () => {
  it('404s linking to a trashed person (peopleCheck excludes them, so rows.length !== 2)', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM people WHERE id IN')) {
        expect(sql).toContain('deleted_at IS NULL');
        return { rows: [{ id: 1 }] }; // only one of the two comes back -- the trashed one is filtered out
      }
      if (sql.includes('FROM relationships WHERE')) return { rows: [] };
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/relationships')
      .send({ person_id: 1, related_person_id: 2, relationship_type: 'parent' });

    expect(res.status).toBe(404);
  });
});
