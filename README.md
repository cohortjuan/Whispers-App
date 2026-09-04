# 🎙️ Whispers App

A place to save audio (and eventually video) clips of family members — grandparents,
parents, anyone — tied to an actual family tree, so future generations can click on
someone's name and hear their voice instead of just seeing a name on a chart. The name
comes from "whispers of the ancestors" — the idea that keeping someone's voice around
keeps a little more of them around too.

Every family's tree is private. You sign up either by starting a brand-new family tree
or by redeeming an invite code someone in an existing family sent you, and from then on
you only ever see your own family's people, clips, and relationships.

Built for a full-stack class project. React + Vite frontend, Node/Express backend,
PostgreSQL database, all talking over a REST API.

**🔴 Live demo: [whispers-app.vercel.app](https://whispers-app.vercel.app)** — frontend on
Vercel, backend on Render (Starter compute, with a persistent disk mounted for uploads),
database on Neon.

## ✨ Features

- 🔐 **Real accounts, not a shared login.** Email/password signup with bcrypt password
  hashing, server-side sessions (opaque tokens, revocable by deleting a row — not
  self-verifying JWTs), CSRF protection on every mutating request, and account lockout
  after 5 consecutive bad password attempts — enforced with an atomic query, so a burst
  of concurrent guesses can't race past the threshold. CORS only ever allows this app's
  own origin, and expired sessions get swept out on a timer instead of piling up forever.
- 🏠 **A real front door, not a bare login form.** Signed-out visitors land on a video
  hero with the pitch and a signup-first call to action; only signed-in visitors see the
  dashboard at the same address.
- 👪 **Every family's tree is private.** Signing up either starts a brand-new family or
  joins an existing one — from then on, every person, clip, and relationship you see
  (and every file under `/uploads`) is scoped to your family. Nobody in a different
  family can read, edit, or stream your family's data, even by guessing an id or a file
  name.
- ✉️ **Secure invite codes**, not one permanent shareable link. Any family member can
  generate a code from the dashboard to bring someone else in. Each code works exactly
  once, expires after 7 days, and can optionally be locked to one specific email address.
  Already have an account in a different family? The same "have an invite code?" box
  lets you redeem one after the fact and switches you into the family that sent it.
- 🎙️ **Recording is the star feature, not an afterthought.** Every person's page opens
  with a big "capture their voice" card and a large mic button — not a form buried
  under a toggle. Recording happens straight from the browser mic
  (`MediaRecorder`), with a fallback to uploading an existing audio/video file.
- 🗑️ **Nothing irreplaceable is ever one click from gone.** Deleting a person *or* a
  recording moves it to a Trash page for 30 days, where it can be restored, downloaded
  as a zip backup, or deleted for good on purpose — after that a nightly job hard-deletes
  it and removes the files from disk. Deleting your own account is soft too: it revokes
  every session immediately but leaves your family's tree completely untouched, and you
  can restore the login at `/restore-account` (with your password) within the same 30
  days. That window lives in exactly one place on the backend — `lib/retention.js`.
- 🌳 **An actual connected family tree**, not just a list. The Family Tree page draws
  parents, spouses, and children as a real branching diagram, and each person's own
  profile shows their immediate family (parents/spouse/children) the same way —
  connected boxes with lines, not bullet points. A "show photos" toggle switches each
  person's badge between their real photo and initials, remembered per browser.
- 🌰 **A crash page with somewhere to look, not a blank screen.** If something breaks,
  you get the logo, an honest apology, and a tiny catch-the-acorns game to tap at while
  it sorts itself out — the same little game is also hidden as an easter egg on the
  About page, for anyone who happens to click the right acorn.
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
- `bcryptjs` for password hashing, `express-rate-limit` for login/signup rate limiting
- `multer` for handling audio/video/photo file uploads
- Plain CSS, no UI framework, no paid services anywhere

## 🗂️ How it's organized

```
whispers-app/  (this folder)
├── database/
│   ├── schema.sql        # tables: families, people, relationships, clips, users, sessions, invites
│   └── seed.sql          # intentionally empty (see the comment at the top) -- create
│                           your first account by using the app itself
├── backend/
│   ├── src/
│   │   ├── server.js       # starts express
│   │   ├── app.js          # express app + routes + middleware wiring
│   │   ├── db/pool.js       # postgres connection pool, also applies schema.sql on boot
│   │   ├── lib/             # password hashing/breach-check, session token helpers
│   │   ├── middleware/      # requireAuth, requireFileAccess, csrf, file upload, errors
│   │   └── routes/          # auth.js, people.js, relationships.js, clips.js
│   ├── uploads/             # audio/video/photo files land here (git-ignored)
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── tree-logo.svg       # light-mode logo + background watermark
│   │   └── tree-logo-dark.svg  # dark-mode variant (recolored, not just inverted)
│   ├── src/
│   │   ├── pages/          # Landing, LoginPage, SignupPage, Dashboard, PersonDetail,
│   │   │                     PersonForm, FamilyTree, About
│   │   ├── components/     # FamilyPanel, PersonCard, ClipPlayer, ClipUploadForm,
│   │   │                     TreeNode, RequireAuth, HomeGate, NavBar, etc.
│   │   ├── context/AuthContext.jsx  # who's logged in + which family, app-wide
│   │   ├── api/client.js   # fetch wrapper (handles the CSRF header + cookies)
│   │   └── index.css       # the whole design system: colors as css variables
│   │                         (light + dark theme), warmth/texture, header styling
│   └── .env.example
└── docker-compose.yml       # spins up local postgres
```

## 🗃️ The data model

**`families`** is the sharing boundary — everything else hangs off it. **`people`**
holds each family member (name, birth/death dates, bio, photo) and belongs to exactly
one family. **`clips`** holds the audio/video recordings, each pointing at one person.
**`relationships`** holds directed links between two people — either `parent` (one
person is the parent of another) or `spouse` (symmetric, stored once per couple). The
family tree page reads every person + every relationship in your family and builds the
actual tree in the browser.

**`users`** are login accounts, deliberately separate from `people` — a login answers
"who is this, and which family are they in," not "which person on the tree are they."
**`sessions`** are opaque, revocable server-side tokens (not JWTs). **`invites`** are how
someone joins a family: single-use, expiring, optionally locked to one email address —
see the Features section above.

Audio/video/photo files themselves live on disk in `backend/uploads/`, not in the
database — Postgres just stores the filename and metadata (size, type, which person it
belongs to), and every request for one of those files is checked against the requester's
own family before it's served.

## ⚙️ Setup

### 1. Start Postgres

If you have Docker:

```bash
docker compose up -d
```

This spins up Postgres on `localhost:5432` and creates the `whispers_app` database.
Table creation happens automatically the first time the backend boots (step 2) — it
re-runs `database/schema.sql` on every boot, so it's always safe to re-run and never
touches data that's already there.

No Docker? Use a free hosted Postgres instead (Supabase, Neon, Railway all have free
tiers) — you don't need to run `schema.sql` yourself, the backend does it on startup.

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

### 4. Create your account

Open `http://localhost:5173` — there's no seed data and no shared demo login, so you'll
land on the sign-up page first. You have two options there:

- **Start a new family tree** — just pick a name for it. You're now the only member;
  generate an invite code (from the dashboard, once you're in) to bring anyone else in.
- **Join with an invite code** — if someone already made a family and sent you a code,
  enter it here instead and you'll land in their tree.

Already signed up before you had a code? Log in, then use the "have an invite code?"
box on the dashboard to redeem one after the fact — it switches your account into
whichever family sent it.

The moon/sun icon in the navbar toggles dark mode; it's remembered per browser.

## 🔌 API reference

All routes are prefixed with `/api`. Every route below `/people`, `/relationships`, and
`/clips` requires a logged-in session and only ever sees/touches your own family's
data — a valid session for a different family gets the same 404 as a nonexistent id.
Every non-GET request also needs the CSRF header (`X-CSRF-Token`, echoing the
`whispers_csrf` cookie) — see `backend/src/middleware/csrf.js`.

### Auth (`/api/auth`) — no login required for signup/login themselves

| Method | Route | What it does |
|---|---|---|
| POST | `/signup` | create an account — `family_name` to start a new family, or `invite_code` to join one |
| POST | `/login` | log in, sets the session + CSRF cookies |
| POST | `/logout` | ends the current session |
| GET | `/me` | who's logged in and which family they're in |
| POST | `/invites` | generate a one-time invite code for your own family (`email` optional, locks it to one address) |
| POST | `/join-family` | redeem an invite code on an already-logged-in account, switching you into that family |

### Family tree (`/api/people`, `/api/relationships`, `/api/clips`) — login required

| Method | Route | What it does |
|---|---|---|
| GET | `/people` | list everyone in your family |
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

Uploaded files are served from `/uploads/<filename>` on the backend (also login- and
family-scoped, same rules as above).

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

- An invite management screen — see which codes you've generated, whether they've been
  used yet, and revoke one before it's redeemed (right now a code is fire-and-forget
  once you generate it; you can see it once and that's it)
- Roles within a family (e.g. an "owner" who can remove members or delete the whole
  tree, vs. an ordinary member who can't)
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
- `backend/uploads/` is local disk storage, which doesn't survive a redeploy on most
  hosts (Render, Railway, etc. use an ephemeral filesystem by default) unless you attach
  a persistent disk and point `UPLOAD_DIR_PATH` at its mount path (see `.env.example`) —
  the live demo does this on Render's Disks feature. Moving to S3/R2/Backblaze instead
  would drop the persistent-disk dependency entirely and is worth it at real scale.
