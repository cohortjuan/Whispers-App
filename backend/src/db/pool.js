import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '../../../database/schema.sql');

if (!process.env.DATABASE_URL) {
  console.error('missing DATABASE_URL env var. copy backend/.env.example to backend/.env and fill it in');
  process.exit(1);
}

// one shared pool, every route just borrows a connection from this.
// hosted postgres (neon, supabase, render, railway, ...) all require ssl;
// local docker postgres doesn't speak ssl at all. DATABASE_SSL lets you say
// so explicitly (for a non-localhost hostname that's still plaintext, e.g. a
// docker-compose service name or a LAN box) -- falls back to guessing from
// the hostname only when that's not set, so existing setups keep working
function resolveSsl() {
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL === 'false') return false;
  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  return isLocal ? false : { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(),
});

pool.on('error', (err) => {
  console.error('unexpected error on idle postgres client', err);
  process.exit(1);
});

// quick check on startup so we fail fast if the db is unreachable
export async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

// schema.sql is CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
// throughout, so running it against an already-populated database is a
// harmless no-op except for whatever tables/indexes are actually missing.
// Hosted postgres (Neon, Render, ...) doesn't auto-run
// docker-entrypoint-initdb.d the way local docker compose does, so without
// this, a schema change only ever reaches production if someone remembers
// to run schema.sql against it by hand after deploying.
export async function ensureSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}

// every route's "get/update/delete by id" handler ends the same way: run the
// query, and if nothing came back, send a 404 instead of the row. this does
// both parts so the routes don't each repeat the same length-check
export async function queryOrNotFound(res, query, params, notFoundMessage) {
  const result = await pool.query(query, params);
  if (result.rows.length === 0) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }
  return result.rows[0];
}
