import { app } from './app.js';
import { testConnection, ensureSchema, cleanupExpiredSessions } from './db/pool.js';

const PORT = process.env.PORT || 5000;
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

// check we can actually reach postgres, then make sure it actually has every
// table schema.sql expects, before starting the server -- way easier to
// debug than random "relation does not exist" errors on the first request
testConnection()
  .then(() => ensureSchema())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`whispers app api running on http://localhost:${PORT}`);
    });

    // sweeps out expired sessions instead of letting them pile up forever
    // (see cleanupExpiredSessions' own comment in db/pool.js). errors here
    // are logged, not fatal -- a missed sweep just means a bigger table
    // until the next one runs, not a broken app.
    setInterval(() => {
      cleanupExpiredSessions().catch((err) => console.error('session cleanup failed:', err.message));
    }, SESSION_CLEANUP_INTERVAL_MS);
  })
  .catch((err) => {
    console.error('could not connect to postgres, is it running? check your DATABASE_URL in .env');
    console.error(err.message);
    process.exit(1);
  });
