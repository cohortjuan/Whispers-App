import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

import { peopleRouter } from './routes/people.js';
import { relationshipsRouter } from './routes/relationships.js';
import { clipsRouter } from './routes/clips.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { UPLOAD_DIR } from './middleware/upload.js';

dotenv.config();

export const app = express();

// only let the frontend origin(s) listed in .env talk to this api
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());
app.use(cors({ origin: allowedOrigins }));

app.use(express.json());

// serves the actual audio/video files, express.static handles range requests
// on its own so scrubbing through an audio clip in the browser just works
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/people', peopleRouter);
app.use('/api/relationships', relationshipsRouter);
app.use('/api/clips', clipsRouter);

app.use(notFound);
app.use(errorHandler);
