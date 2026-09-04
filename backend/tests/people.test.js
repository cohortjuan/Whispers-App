import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// same reasoning as tests/requireAuth.test.js: mock the db pool before
// anything imports it, so the real module's process.exit(1)-if-no-
// DATABASE_URL never runs
vi.mock('../src/db/pool.js', () => {
  const pool = { query: vi.fn() };
  // people.js's real routes lean on this helper (db/pool.js's own version)
  // for every get/update/delete-by-id handler -- has to be reimplemented
  // here too since mocking the module replaces the whole thing, not just `pool`
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
const { peopleRouter } = await import('../src/routes/people.js');

const FAMILY_ID = 7;

// peopleRouter itself doesn't apply requireAuth (that happens once, at the
// app.js mount level) -- this stands in for it the same way a real request
// would arrive with req.user already attached
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, family: { id: FAMILY_ID } };
    next();
  });
  app.use('/api/people', peopleRouter);
  return app;
}

// applies to every test below -- without this, pool.query.mock.calls
// accumulates across tests and mock.calls[0] would mean "first call in the
// whole file," not "first call in this test"
beforeEach(() => {
  pool.query.mockReset();
});

describe('GET /api/people', () => {
  it('excludes trashed people from the listing', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    await request(app).get('/api/people');

    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');
  });
});

describe('GET /api/people/trash', () => {
  it('is registered ahead of /:id and only returns trashed people', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const res = await request(app).get('/api/people/trash');

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NOT NULL');
    expect(pool.query.mock.calls[0][0]).toContain('purge_at');
  });
});

describe('GET /api/people/:id', () => {
  it('404s a trashed person on the normal detail route', async () => {
    pool.query.mockResolvedValue({ rows: [] }); // simulates the deleted_at filter excluding it
    const app = buildApp();

    const res = await request(app).get('/api/people/42');

    expect(res.status).toBe(404);
    expect(pool.query.mock.calls[0][0]).toContain('p.deleted_at IS NULL');
  });
});

describe('POST /api/people (free-tier cap)', () => {
  it('excludes trashed people from the MAX_PEOPLE count, so trashing someone frees a slot', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*)::int AS count')) {
        expect(sql).toContain('deleted_at IS NULL');
        return { rows: [{ count: 49 }] };
      }
      if (sql.includes('INSERT INTO people')) {
        return { rows: [{ id: 99, first_name: 'New', last_name: 'Person' }] };
      }
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app)
      .post('/api/people')
      .send({ first_name: 'New', last_name: 'Person' });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/people/:id', () => {
  it('soft-deletes (UPDATE ... deleted_at = now()) instead of hard-deleting', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 42, first_name: 'A', last_name: 'B', deleted_at: new Date().toISOString() }] });
    const app = buildApp();

    const res = await request(app).delete('/api/people/42');

    expect(res.status).toBe(200);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('UPDATE people SET deleted_at = now()');
    expect(sql).not.toMatch(/^\s*DELETE FROM people/i);
  });

  it("404s trying to trash someone already in the trash (deleted_at IS NULL guard on the WHERE)", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const res = await request(app).delete('/api/people/42');

    expect(res.status).toBe(404);
    expect(pool.query.mock.calls[0][0]).toContain('deleted_at IS NULL');
  });
});

describe('POST /api/people/:id/restore', () => {
  it('clears deleted_at, only within the retention window', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 42, deleted_at: null }] });
    const app = buildApp();

    const res = await request(app).post('/api/people/42/restore');

    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('SET deleted_at = NULL');
    expect(sql).toContain("deleted_at > now() - make_interval(days => $3)");
    expect(params).toEqual([expect.anything(), FAMILY_ID, 30]);
  });

  it('404s a person not currently in the trash', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const res = await request(app).post('/api/people/42/restore');

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/people/:id/permanent', () => {
  it('issues a real DELETE FROM people, only for someone already trashed', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT file_path FROM clips')) return { rows: [] };
      if (sql.includes('DELETE FROM people')) {
        expect(sql).toContain('deleted_at IS NOT NULL');
        return { rows: [{ id: 42, photo_url: null }] };
      }
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app).delete('/api/people/42/permanent');

    expect(res.status).toBe(204);
  });

  it('404s a person who is not in the trash', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT file_path FROM clips')) return { rows: [] };
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app).delete('/api/people/42/permanent');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/people/:id/export', () => {
  it("404s when the person has no clips (never reaches the zip stream)", async () => {
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM people WHERE id')) return { rows: [{ id: 42, first_name: 'A', last_name: 'B' }] };
      if (sql.includes('FROM clips WHERE person_id')) return { rows: [] };
      return { rows: [] };
    });
    const app = buildApp();

    const res = await request(app).get('/api/people/42/export');

    expect(res.status).toBe(404);
  });

  it('404s when the person does not exist in this family (no deleted_at filter needed either way)', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const res = await request(app).get('/api/people/999/export');

    expect(res.status).toBe(404);
  });
});
