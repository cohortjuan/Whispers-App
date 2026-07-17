import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

import { peopleRouter } from "./routes/people.js";
import { relationshipsRouter } from "./routes/relationships.js";
import { clipsRouter } from "./routes/clips.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { UPLOAD_DIR } from "./middleware/upload.js";

dotenv.config();

export const app = express();

// only let the frontend origin(s) listed in .env talk to this api
const configuredOrigins = (
  process.env.CORS_ORIGIN ||
  "http://localhost:5173,https://whispers-app.vercel.app"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      const isAllowedOrigin =
        configuredOrigins.includes(origin) ||
        /^https:\/\/.*\.vercel\.app$/i.test(origin);

      return callback(null, isAllowedOrigin);
    },
    credentials: true,
  }),
);

app.use(express.json());

// serves the actual audio/video files, express.static handles range requests
// on its own so scrubbing through an audio clip in the browser just works
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/people", peopleRouter);
app.use("/api/relationships", relationshipsRouter);
app.use("/api/clips", clipsRouter);

app.use(notFound);
app.use(errorHandler);
