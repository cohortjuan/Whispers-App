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
import { requireFileAccess } from "./middleware/requireFileAccess.js";
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
    // Exact allowlist only -- *.vercel.app is a shared public hosting
    // domain anyone can deploy a project under for free, and this API
    // sends credentialed responses (Access-Control-Allow-Credentials).
    // Matching that whole suffix let ANY vercel.app-hosted page, not just
    // this one, ride a logged-in visitor's SameSite=None session cookie
    // and read their family's data back via a plain GET (GET is exempt
    // from CSRF protection by design -- see middleware/csrf.js). Add a
    // specific preview-deployment URL to CORS_ORIGIN if one is ever
    // actually needed instead of widening this again.
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      return callback(null, configuredOrigins.includes(origin));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

// serves the actual audio/video files, express.static handles range requests
// on its own so scrubbing through an audio clip in the browser just works.
// requireAuth closes the "logged in at all" gap a bare /api login wouldn't
// otherwise cover here; requireFileAccess closes the next one -- being
// logged in only proves who you are, not that this particular file belongs
// to your family, so it checks that before express.static ever serves the
// bytes. Same two-layer scoping as every /api/people, /api/clips, and
// /api/relationships route.
app.use("/uploads", requireAuth, requireFileAccess, express.static(UPLOAD_DIR));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// signup/login obviously can't require being logged in first -- auth.js
// applies requireAuth itself, per-route, to /logout and /me only
app.use("/api/auth", authRouter);

// every other route requires a logged-in session; each route then scopes
// its own queries by req.user.family.id so one family's data is never
// visible to another (see routes/people.js, relationships.js, clips.js).
// csrfProtection covers every state-changing request on top of that.
app.use("/api/people", requireAuth, csrfProtection, peopleRouter);
app.use("/api/relationships", requireAuth, csrfProtection, relationshipsRouter);
app.use("/api/clips", requireAuth, csrfProtection, clipsRouter);

app.use(notFound);
app.use(errorHandler);
