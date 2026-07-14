# 🎙️ Whispers App

A place to save audio (and eventually video) clips of family members — grandparents,
parents, anyone — tied to an actual family tree, so future generations can click on
someone's name and hear their voice instead of just seeing a name on a chart. The name
comes from "whispers of the ancestors" — the idea that keeping someone's voice around
keeps a little more of them around too.

Built for a full-stack class project. React + Vite frontend, Node/Express backend,
PostgreSQL database, all talking over a REST API.

**🔴 Live demo: [whispers-app.vercel.app](https://whispers-app.vercel.app)** — frontend on
Vercel, backend on Render, database on Neon. Free-tier hosting, so the backend spins
down after ~15 min idle (first load after a lull takes 30-60s to wake up), and uploaded
clips don't survive a redeploy.

## ✨ Features

- 🎙️ **Recording is the star feature, not an afterthought.** Every person's page opens
  with a big "capture their voice" card and a large mic button — not a form buried
  under a toggle. Recording happens straight from the browser mic
  (`MediaRecorder`), with a fallback to uploading an existing audio/video file.
- 🌳 **An actual connected family tree**, not just a list. The Family Tree page draws
  parents, spouses, and children as a real branching diagram, and each person's own
  profile shows their immediate family (parents/spouse/children) the same way —
  connected boxes with lines, not bullet points.
- 🌙 **Dark mode** with its own "regal dark purple" palette (toggle in the navbar) —
  every color in the app is a CSS variable, so it's the same layout in either theme.
  The tree logo has a real second color variant for dark mode (not just an inverted
  filter), so it still reads clearly against the dark background.
- 🕯️ **Warm, unboxy visuals on purpose**: circular photo frames, a subtle paper-grain
  background, a large low-opacity tree watermark, and dashboard cards that sit at a
  slight scattered tilt like photos pinned to a corkboard rather than a rigid grid.

## 🛠️ Tech stack

- React 18 + Vite (JavaScript, no TypeScript)
- Node.js + Express
- PostgreSQL (via Docker, or any hosted Postgres like Supabase/Railway/Neon)
- `pg` for the database driver
- `multer` for handling audio/video file uploads
- Plain CSS, no UI framework, no paid services anywhere

## 🗂️ How it's organized

```
whispers-app/  (this folder)
├── database/
│   ├── schema.sql        # tables: people, relationships, clips
│   └── seed.sql          # a few sample rows so the app isn't empty on first run
├── backend/
│   ├── src/
│   │   ├── server.js      # starts express
│   │   ├── app.js         # express app + routes + middleware wiring
│   │   ├── db/pool.js      # postgres connection pool
│   │   ├── middleware/     # file upload handling + error handling
│   │   └── routes/         # people.js, relationships.js, clips.js
│   ├── uploads/            # audio/video files land here (git-ignored)
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── tree-logo.svg       # light-mode logo + background watermark
│   │   └── tree-logo-dark.svg  # dark-mode variant (recolored, not just inverted)
│   ├── src/
│   │   ├── pages/          # Dashboard, PersonDetail, PersonForm, FamilyTree
│   │   ├── components/     # PersonCard, ClipPlayer, ClipUploadForm, TreeNode, etc.
│   │   ├── api/client.js   # fetch wrapper that talks to the backend
│   │   └── index.css       # the whole design system: colors as css variables
│   │                         (light + dark theme), warmth/texture, header styling
│   └── .env.example
└── docker-compose.yml       # spins up local postgres
```

## 🗃️ The data model

Three tables. `people` holds each family member (name, birth/death dates, bio, photo).
`clips` holds the audio/video recordings, each pointing at one person. `relationships`
holds directed links between two people — either `parent` (one person is the parent of
another) or `spouse` (symmetric, stored once per couple). The family tree page reads
every person + every relationship and builds the actual tree in the browser.

Audio/video files themselves live on disk in `backend/uploads/`, not in the database —
Postgres just stores the filename and metadata (size, type, which person it belongs to).

## ⚙️ Setup

### 1. Start Postgres

If you have Docker:

```bash
docker compose up -d
```

This spins up Postgres on `localhost:5432`, creates the `whispers_app` database, and
automatically runs `database/schema.sql` and `database/seed.sql` the first time it starts.

No Docker? Use a free hosted Postgres instead (Supabase, Neon, Railway all have free
tiers) and run `database/schema.sql` against it yourself:

```bash
psql "<your-connection-string>" -f database/schema.sql
psql "<your-connection-string>" -f database/seed.sql   # optional sample data
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # edit DATABASE_URL if you're not using the docker defaults
npm install
npm run dev                # starts on http://localhost:5000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env       # defaults to http://localhost:5000/api, change if needed
npm install
npm run dev                 # starts on http://localhost:5173
```

Open `http://localhost:5173` and you should see the sample family (or an empty
dashboard if you skipped the seed data). The moon/sun icon in the navbar toggles
dark mode; it's remembered per browser.

## 🔌 API reference

All routes are prefixed with `/api`.

| Method | Route | What it does |
|---|---|---|
| GET | `/people` | list everyone |
| GET | `/people/:id` | one person |
| POST | `/people` | create a person |
| PUT | `/people/:id` | update a person |
| DELETE | `/people/:id` | delete a person (cascades to their clips + relationships) |
| GET | `/relationships?person_id=` | list relationships, optionally filtered to one person |
| POST | `/relationships` | link two people (`parent` or `spouse`) |
| DELETE | `/relationships/:id` | unlink two people |
| GET | `/clips?person_id=` | list clips, optionally filtered to one person |
| POST | `/clips` | upload a clip (multipart form: `file` + metadata) |
| PUT | `/clips/:id` | edit a clip's title/description/date |
| DELETE | `/clips/:id` | delete a clip and its file |

Uploaded files are served from `/uploads/<filename>` on the backend.

## 🌱 Git / GitHub

`.env` files are already in `.gitignore` at every level (root, backend, frontend) so
your database credentials never get committed. Double check before your first push:

```bash
git init
git add .
git status              # confirm no .env files show up here
git commit -m "initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 🚀 Where this could go next

- User accounts, so each family has their own private tree (would need auth + a
  `users` table, and every query scoped to `user_id`)
- Actual payment/subscription handling for the "storing this for generations" pitch
- Video clips are already supported end to end in the schema and upload code
  (`media_type` column, `<video>` player) — just needs a UI toggle exposed more, and
  maybe thumbnail generation
- A "download everything" export so families always have an offline backup
- Photos, tagged to family members — not just the one profile photo per person.
  Upload a picture and tag everyone in it (at least one person required per photo).
  Each tagged person's profile would show a gallery of every photo they appear in —
  a thumbnail row sitting right below their header/caption and above the "Capture
  Their Voice" recording section. Would need a `photos` table plus a `photo_tags`
  join table (photo_id, person_id) for the many-to-many tagging
- Before deploying anywhere: `backend/uploads/` is local disk storage, which doesn't
  survive a redeploy on most hosts (Render, Railway, etc. use an ephemeral
  filesystem by default). Moving clip storage to S3/R2/Backblaze (or paying for a
  persistent disk) is the one real change needed before this goes live anywhere.
