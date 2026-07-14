# Briefing for whoever's debugging this (hi, other Claude)

You're picking this up mid-project. Read this before touching anything — this is a
graded class assignment with specific required parameters, and it's easy to
"fix" a bug by accidentally removing something that's actually a requirement.

## The assignment's required parameters (do not remove any of these)

- React frontend
- Vite as the build system
- Plain JavaScript (no TypeScript)
- Node.js + Express backend
- PostgreSQL (currently via Docker, `docker-compose.yml` at repo root)
- The `pg` npm package specifically — no ORM, no ODM
- REST API endpoints (not GraphQL, not tRPC, not RPC-style)
- Git + GitHub
- All secrets/config in `.env` files, and `.env` must stay in `.gitignore` at every
  level (root, backend, frontend) — never let a real `.env` get committed
- Full CRUD (create, read, update, delete) on real data
- **No backend-as-a-service for the core CRUD.** Supabase/Firebase/etc as a CRUD
  engine is explicitly disallowed by the assignment — this app talks to Postgres
  directly through Express routes and raw SQL via `pg`. Don't introduce an ORM or
  a BaaS SDK to "simplify" something.

If a fix seems to require breaking one of the above, stop and flag it instead of
just doing it.

## What this app is

"Whispers App" — a family audio archive. Users add family members, record or
upload audio/video clips of them, and link people together (parent/child,
spouse) into an actual family tree. Point of the project: preserve elders'
voices/stories across generations.

## Architecture

```
Whispers App/
├── database/
│   ├── schema.sql       # 3 tables: people, relationships, clips
│   └── seed.sql         # sample data, auto-loaded by docker-compose
├── backend/
│   ├── src/server.js     # entry point, checks db connection then listens
│   ├── src/app.js        # express app, cors, static /uploads serving, route mounting
│   ├── src/db/pool.js    # pg Pool, reads DATABASE_URL from .env
│   ├── src/middleware/
│   │   ├── upload.js      # multer config — disk storage to backend/uploads/,
│   │   │                    validates mimetype is audio/* or video/* (base type
│   │   │                    only, NOT exact match — recorded blobs carry codec
│   │   │                    suffixes like "audio/webm;codecs=opus")
│   │   └── errorHandler.js
│   └── src/routes/
│       ├── people.js         # GET/POST /api/people, GET/PUT/DELETE /api/people/:id
│       ├── relationships.js  # GET/POST /api/relationships, DELETE /api/relationships/:id
│       │                       type is 'parent' (person_id is parent of related_person_id)
│       │                       or 'spouse' (symmetric, stored once)
│       └── clips.js          # GET/POST /api/clips, PUT/DELETE /api/clips/:id
│                                POST is multipart/form-data via multer
└── frontend/
    ├── src/pages/
    │   ├── Dashboard.jsx       # grid of all people
    │   ├── PersonForm.jsx      # add/edit person (mode prop: 'create' | 'edit')
    │   ├── PersonDetail.jsx    # bio, clips, relationships, upload form
    │   └── FamilyTree.jsx      # builds the whole tree client-side from
    │                             /api/people + /api/relationships
    ├── src/components/
    │   ├── AudioRecorder.jsx   # MediaRecorder-based mic recording, handles
    │   │                         permission denial + tab-backgrounding (see below)
    │   ├── ClipUploadForm.jsx  # toggles between "record now" and "upload a file"
    │   ├── ClipPlayer.jsx, PersonCard.jsx, RelationshipForm.jsx, TreeNode.jsx
    │   └── NavBar.jsx
    └── src/api/client.js       # fetch wrapper, base URL from VITE_API_URL
```

## Things that look weird but are intentional — don't "fix" these

- **`AudioRecorder.jsx` checks `document.hidden` via a `visibilitychange`
  listener** and auto-stops the recording if the tab is backgrounded or the
  phone screen locks, instead of silently losing the audio. This is deliberate
  cross-platform handling, not dead code.
- **`upload.js`'s `fileFilter` checks `mimetype.split(';')[0]` instead of an
  exact match.** This is required because browser-recorded audio reports
  mimetypes like `audio/webm;codecs=opus`, not a clean `audio/webm`. An exact
  allowlist match here will silently reject valid recordings.
- **`TreeNode.jsx` has an early-return guard** (`if (renderedIds.has(personId))
  return null`). Without it, a couple who are both "roots" (nobody's parents on
  record) would each draw a separate tree instead of one shared box. This was
  a real bug that got fixed once already — if you see the tree rendering
  duplicate root couples, this guard is what's supposed to prevent that.
- **No auth, no user accounts.** Single shared workspace, by design, per this
  week's scope. Don't add login unless the user explicitly asks.
- **Relationships have a direction.** `{person_id, related_person_id,
  relationship_type: 'parent'}` means `person_id` IS THE PARENT OF
  `related_person_id`. Getting this backwards breaks the tree silently (kids
  show up as parents and vice versa) without throwing any error.

## Current known gaps / untested areas

The app was built in a sandboxed environment with no internet access, so:
- `npm install` was never actually run — only `node --check` syntax validation
  and manual code review were done. Dependency versions in `package.json` are
  unverified against real installs.
- Nothing has been click-tested in an actual browser yet.
- `docker compose up -d` has never actually been run against this schema.

So: normal early-stage bugs are expected and fine to fix. Just don't fix them
by ripping out one of the required parameters or the intentional behaviors
listed above.

## Naming note

Everything was renamed from "Heirloom Voices" to "Whispers App" (package.json
names, docker-compose service/db/user names, README, page title, navbar) —
`whispers` / `whispers_app` is the current Postgres user/db name in
`docker-compose.yml` and `.env.example`. If there's an old Docker volume
lingering from before this rename, `docker compose down -v` clears it.
