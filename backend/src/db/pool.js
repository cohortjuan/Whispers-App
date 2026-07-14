import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('missing DATABASE_URL env var. copy backend/.env.example to backend/.env and fill it in');
  process.exit(1);
}

// one shared pool, every route just borrows a connection from this.
// hosted postgres (neon, supabase, render, railway, ...) all require ssl;
// local docker postgres doesn't speak ssl at all, so only turn it on when
// we're clearly not pointed at localhost
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
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
