# 🎙️ Whispers App

Save the voices of the people you love. Audio and video clips of family members, tied to a real family tree — so future generations can click a name and *hear* them instead of just reading them off a chart.

The name comes from "whispers of the ancestors": keeping someone's voice around keeps a little more of them around too.

**🔴 Live demo: [whispers-app.vercel.app](https://whispers-app.vercel.app)** — React + Vite on Vercel, Node/Express on Render with a persistent disk, Postgres on Neon.

## ✨ Features

**🎙️ Recording is the star, not an afterthought.** Every person's page opens with a big "capture their voice" card and a large mic button — recording happens straight from the browser via `MediaRecorder`, with file upload as a fallback.

**🌳 An actual connected family tree.** Parents, spouses, and children drawn as a real branching diagram, not a bulleted list. Each profile shows their immediate family the same way, and a photos toggle switches every badge between real portraits and initials.

**👪 Every family's tree is completely private.** Signing up either starts a new family or joins one by invite. From then on every person, clip, relationship, and uploaded file is scoped to your family — nobody outside it can read, edit, or stream your data, even knowing an exact id or filename.

**🔐 Real accounts, properly built.** Bcrypt hashing, opaque server-side sessions (revocable by deleting a row — not self-verifying JWTs), CSRF protection on every mutating request, and account lockout after 5 bad attempts enforced by an atomic query, so concurrent guesses can't race past the threshold.

**✉️ Single-use invite codes**, not one permanent shareable link. Each works exactly once, expires after 7 days, and can be locked to a specific email address. Already have an account elsewhere? Redeem a code after the fact to switch families.

**🗑️ Nothing irreplaceable is ever one click from gone.** Deleting a person *or* a recording moves it to a Trash page for 30 days, where it can be restored, downloaded as a zip backup, or deliberately deleted for good. A nightly job handles the rest. Deleting your own account is soft too — it revokes every session immediately but leaves your family's tree untouched, and the login can be restored within the same window.

**🌰 A crash page with somewhere to look.** If something breaks you get the logo, an honest apology, and a tiny catch-the-acorns game to play while it sorts itself out — hidden as an easter egg on the About page too.

**🌙 Dark mode** with its own regal purple palette, down to a genuinely recolored logo variant rather than an inverted filter.

**🕯️ Warm, unboxy visuals on purpose** — circular photo frames, paper-grain texture, a low-opacity tree watermark, and dashboard cards tilted like photos pinned to a corkboard.

## 🛠️ Stack

React 18 + Vite · Node + Express · PostgreSQL via `pg` · `multer` for uploads · `bcryptjs` · `express-rate-limit` · plain CSS, no UI framework, no paid services.

## 🗃️ Data model

`families` is the sharing boundary — everything hangs off it. `people` holds each family member; `clips` holds their recordings; `relationships` holds directed `parent` links and symmetric `spouse` links, which the tree page assembles in the browser.

`users` are login accounts, deliberately separate from `people` — a login answers "who is this and which family are they in," not "which person on the tree are they." `sessions` are opaque and revocable. `invites` are single-use and expiring.

Media lives on disk, not in the database; Postgres stores the filename and metadata, and every file request is checked against the requester's family before it's served.

## ⚙️ Setup

```bash
docker compose up -d                        # Postgres on :5432

cd backend  && cp .env.example .env && npm install && npm run dev   # :5000
cd frontend && cp .env.example .env && npm install && npm run dev   # :5173
```

No Docker? Any hosted Postgres works (Neon, Supabase, Railway). You never need to run `schema.sql` yourself — the backend applies it on boot, safely and repeatedly.

Then open `http://localhost:5173` and sign up. There's no seed data and no shared demo login: either start a new family tree, or enter an invite code to join an existing one.

## 🔌 API

All routes are under `/api`. Everything below `/people`, `/relationships`, and `/clips` requires a session and only ever touches your own family's data — a valid session for a different family gets the same 404 as a nonexistent id. Non-GET requests need the `X-CSRF-Token` header.

| Method | Route | What it does |
|---|---|---|
| POST | `/auth/signup` | create an account (`family_name` to start a family, or `invite_code` to join) |
| POST | `/auth/login` · `/auth/logout` | session in / out |
| GET | `/auth/me` | who's logged in and which family |
| POST | `/auth/invites` | generate a one-time invite code |
| POST | `/auth/join-family` | redeem a code on an existing account |
| DELETE | `/auth/me` | soft-delete your login (restorable for 30 days) |
| POST | `/auth/restore` | bring a deleted login back, password required |
| GET/POST/PUT | `/people`, `/people/:id` | list, view, create, update |
| DELETE | `/people/:id` | move to trash · `/restore` · `/permanent` |
| GET | `/people/:id/export` | zip of everything they've recorded |
| GET/POST/PUT | `/clips`, `/clips/:id` | list, upload (multipart), edit metadata |
| DELETE | `/clips/:id` | move to trash · `/restore` · `/permanent` |
| GET | `/people/trash`, `/clips/trash` | what's recoverable, and when it expires |
| GET/POST/DELETE | `/relationships` | link and unlink people |

Uploads are served from `/uploads/<filename>`, login- and family-scoped by the same rules.

## 🗂️ Layout

```
database/schema.sql      families, people, relationships, clips, users, sessions, invites
backend/src/
  app.js server.js       express wiring, startup, background jobs
  db/pool.js             connection pool, applies schema on boot
  jobs/purge.js          nightly hard-delete past the retention window
  lib/                   passwords, sessions, mailer, retention window
  middleware/            requireAuth, requireFileAccess, csrf, uploads, errors
  routes/                auth, people, relationships, clips
frontend/src/
  pages/ components/ context/ api/
  index.css              the whole design system, light + dark
```

## 🌱 Where this goes next

- **Photo galleries** — upload a picture, tag everyone in it, and show each person a gallery of every photo they appear in (needs a `photos` table plus a `photo_tags` join table)
- **Invite management** — see which codes you've issued, whether they've been used, and revoke one before it's redeemed
- **Roles within a family** — an owner who can remove members, versus an ordinary member who can't
- **Object storage** — moving uploads to S3/R2 would drop the persistent-disk dependency entirely
