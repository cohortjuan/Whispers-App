import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import dotenv from "dotenv";

import { peopleRouter } from "./routes/people.js";
import { relationshipsRouter } from "./routes/relationships.js";
import { clipsRouter } from "./routes/clips.js";
import { authRouter } from "./routes/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { csrfProtection } from "./middleware/csrf.js";
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
app.use(cookieParser());

// serves the actual audio/video files, express.static handles range requests
// on its own so scrubbing through an audio clip in the browser just works.
// requireAuth in front of it closes the gap a login-only /api would otherwise
// leave open: without this, anyone with (or guessing) a clip's file path
// could stream it directly, session or no session -- the family's recordings
// are the actual private content here, more so than the API responses about
// them.
app.use("/uploads", requireAuth, express.static(UPLOAD_DIR));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// signup/login obviously can't require being logged in first -- auth.js
// applies requireAuth itself, per-route, to /logout and /me only
app.use("/api/auth", authRouter);

// every other existing route now requires a logged-in session. this app has
// one shared family tree (no per-user ownership), so requireAuth is the
// entire authorization model -- csrfProtection then covers every
// state-changing request on top of that (see middleware/csrf.js)
app.use("/api/people", requireAuth, csrfProtection, peopleRouter);
app.use("/api/relationships", requireAuth, csrfProtection, relationshipsRouter);
app.use("/api/clips", requireAuth, csrfProtection, clipsRouter);

app.use(notFound);
app.use(errorHandler);
