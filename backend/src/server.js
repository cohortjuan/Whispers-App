import { app } from './app.js';
import { testConnection } from './db/pool.js';

const PORT = process.env.PORT || 5000;

// check we can actually reach postgres before starting the server,
// way easier to debug than random failures on the first request
testConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`whispers app api running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('could not connect to postgres, is it running? check your DATABASE_URL in .env');
    console.error(err.message);
    process.exit(1);
  });
