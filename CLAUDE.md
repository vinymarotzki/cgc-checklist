# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The application lives at the repository root — `package.json`, `src/`, `.env.local`
and every config file sit directly under the repo root, no subdirectory. This used to
be split (app nested in `sasi-checklist/`, a stale duplicate of `src/` at the root); both
were consolidated into a single root-level app. Do not recreate a nested copy.

## Commands

```bash
npm install
npm run dev        # next dev
npm run build      # next build
npm run lint       # eslint .
npm run db:seed    # npx tsx src/lib/seed.ts — populates activities in Turso
```

There is no unit test suite. Instead, **every change is tested in the single Docker
test container before its PR is opened into `develop`** (`lint`/`build` alone do not
count):

```bash
npm run test:docker        # rebuilds + recreates the container, then runs the smoke test
npm run test:smoke         # smoke test only, against an already-running container
npm run test:docker:down   # stops and removes the test containers
```

The `test` profile of `docker-compose.yml` runs the production build (`runner`
stage) as `cgc-checklist-test` on port 3100, next to a `cgc-checklist-test-mocks`
container (`scripts/test/mock-services.mjs`) that fakes `AUTH_USER_ENDPOINT` and the
cgc-atividades proxy target. It is isolated on purpose: it never reads `.env.local`,
the database is a throwaway libSQL file inside the container, and the two fixed
tokens are `token-usuario-a` and `token-usuario-b` (two users, so ownership rules
can be tested). `scripts/test/smoke.mjs` holds the checks; when a change adds
behavior, add its checks there in the same branch and report what ran in the PR's
Summary.

`db:seed` uses `@next/env` `loadEnvConfig`, so it reads the same `.env.local` as the
app; pointing it at the production database is done by swapping env vars, not by a flag.

Local access always needs the token in the URL on the very first visit, e.g.
`http://localhost:3000/?sasi-token=TOKEN`. After that first load the token lives in
`sessionStorage` and the URL is clean — see "Auth". There is **no** localhost bypass:
local development also needs `AUTH_USER_ENDPOINT` set in `.env.local`, otherwise every
token is rejected.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript strict, Tailwind 3, Turso/libSQL
(`@libsql/client`), `xlsx` for spreadsheet export, deployed on Vercel. Path alias
`@/*` maps to `src/*`.

The config is `next.config.js` (CommonJS), currently empty besides the export — no
special tracing/root override needed now that there is a single copy of the app.

## Architecture

This repo used to hold two independent products (Checklist + Atividades do CGC). The
CGC product — routes, API, `cgc_*` tables, the whole `src/lib/sasi-api/` and
`src/lib/cgc/` integration layer — was split out into a sibling repo, `cgc-atividades`
(`../cgc-atividades`), with its own Turso database. What stays here is the Checklist
product plus a small read-only proxy that lets `/controle` show CGC data without
this app talking to the SASI API or the CGC database directly. See `cgc-atividades`'s
own `CLAUDE.md` for that product's conventions — they mostly mirror this file's Auth,
Status vocabulary, Styling and Git workflow sections, since both repos started as
one codebase.

**Checklist de Simulados** — activities stored in Turso, fully owned locally.
Routes: `/` (the checklist itself — there is *no* `/checklist` route),
`/checklists` (list), `/admin` (edit activities/categories), `/history`, and
`/controle` (cross-product report — see below).
API: `/api/checklists`, `/api/activities`, `/api/observations`, `/api/history`.

Every page is a client component (`"use client"`) that fetches its own `/api/...`
route. No server components fetch data, and no page talks to an external API
directly.

### `/controle` — cross-product proxy to cgc-atividades

`/controle` reports on completed activities across both products, but this repo no
longer has local access to CGC data. Instead, two routes proxy to the cgc-atividades
app over HTTP: `/api/controle/cgc` (summary by group) and `/api/controle/cgc/activities`
(completed activities for one group, for XLSX export) both read `CGC_APP_URL` — a
server-only env var, never exposed to the browser — and forward to the matching
`/api/controle/cgc*` route on the cgc-atividades side, which does have the real data.
Both fetches carry a 15s timeout (`AbortSignal.timeout`, matching the
`SASI_API_TIMEOUT_MS` default cgc-atividades uses for its own external calls) so a
slow cgc-atividades degrades to a clean 502 instead of hanging the request. The local
Docker `dev` profile overrides `CGC_APP_URL` to reach the cgc-atividades container via
`host.docker.internal` — see the comment in `docker-compose.yml` and `.env.example`
before assuming an edited `.env.local` isn't taking effect.

### Auth

`src/lib/token.ts` is the single source for the token, on both client and server. The
URL only ever carries `?sasi-token=` (`TOKEN_PARAM`) on the very first request — after
that the token travels through `sessionStorage` on the client and the `x-sasi-token`
header (`TOKEN_HEADER`) on every internal request. The URL never shows the token again.
One rule, no exceptions:

- on first load, the token is read **only** from `?sasi-token=`; the old `?token=`
  fallback is gone;
- an absent param, a different param name, or an empty/whitespace value all mean
  "user without access" — `readSasiToken`/`readSasiTokenHeader` return `null` and the
  caller must refuse;
- there is **no** host bypass. localhost follows the exact same rule as production, so
  what is tested locally is what the end user gets.

`src/hooks/useSasiToken.ts` is the client-side entry point: every page calls
`useSasiToken()` instead of reading `sasi-token` from `useSearchParams()` directly. On
mount, if the URL carries `sasi-token`, the hook saves it to `sessionStorage` and
strips the param from the address bar via `router.replace`; otherwise it falls back to
whatever is already in `sessionStorage`. Internal links no longer carry the token —
they're plain paths (`/checklists`, `/history`, …) — and internal `fetch` calls attach
it with `sasiAuthHeaders(token)` instead of a query string. Losing `sessionStorage`
(closing the tab) means losing access until the user opens a fresh `?sasi-token=` link.

Server side, `authenticateToken` (`src/lib/auth.ts`) validates the token against
`AUTH_USER_ENDPOINT`; without that env var *every* token is rejected, in every
environment.

`requireAuth` is a private per-file copy inside each checklist route
(`/api/activities`, `/api/checklists`, `/api/observations`, `/api/history`), all
reading the token through `readSasiTokenHeader` (never from the URL) so the rule
above cannot drift between them. A shared copy with the same rule lives in
`src/lib/api-auth.ts` and is used by the `/api/controle/*` routes; the four private
copies can be switched to it. (The old `api-auth.ts`, which also returned the raw
token to forward as a Bearer to the SASI API, moved to cgc-atividades with the CGC
routes; nothing in this repo talks to the SASI API anymore.)

`/controle` and `/api/controle/*` require the token like every other screen. They
used to be public, protected only by an unlinked URL. That exposed every completed
checklist and, through the proxy, the cgc-atividades data already authenticated with
`CONTROLE_PROXY_SECRET`, so the secret protected nothing.

Authorization on top of authentication lives in `src/lib/ownership.ts` (`isOwner`):
only the creator renames/deletes a checklist (`created_by_id`), and only the author
edits/deletes an observation (`user_id`). Rows with no recorded owner (the migrated
"Checklist existente", old observations) stay open to any authenticated user. The API
enforces it (403); the screens only hide the buttons. Status/responsible changes and
`/admin` edits stay open to everyone on purpose, because the checklist is
collaborative.

Category-wide operations in `/api/activities` (DELETE/PUT by `category`/`oldCategory`)
require `?checklist=` and return 400 without it. They used to filter by category
alone and hit every checklist at once. Multi-statement writes (checklist create and
delete, activity update + history row, observation write + history row, activity
delete with its observations/history) go through `db.batch(..., "write")`, so they
commit or roll back together.

### Database

`src/lib/db.ts` holds a lazy singleton client plus `initDb()`, which creates every
table with `CREATE TABLE IF NOT EXISTS` and migrates older schemas via `ALTER TABLE`
wrapped in `try/catch` (a thrown "duplicate column" is the "already migrated" signal).
`initDb()` is called at the top of route handlers — there is no migration tool.

Tables: `checklists`, `activities`, `history`, `observations`, `completed_checklists`,
`completed_checklist_items`. (The `cgc_*` tables moved with the CGC product to
cgc-atividades's own database — this database no longer has them.)

### Status vocabulary

`src/lib/checklist-status.ts` is the single source for statuses and their colors:
`SEM_STATUS`, `NAO_INICIADO`, `EM_ANDAMENTO`, `CONCLUIDO`, `IMPEDIDO` (only the middle
three are offered in the selector). Reuse it rather than defining a parallel palette.
cgc-atividades keeps its own copy of this file plus a group-color layer on top
(`src/lib/cgc/colors.ts` there) — the vocabulary itself is meant to stay identical
between the two repos even though they no longer share code.

### Styling

Screens are styled with inline styles, so media queries cannot live there. All
responsive behavior sits in named classes in `src/app/globals.css`
(`.app-header-inner`, `.app-nav`, `.split-card`, `.card-actions`, `.two-col`,
`.field-row`, `.import-row`). Add responsive rules there, not inline.

Icons are `lucide-react` components (e.g. `<Search size={14} />`), not emoji — every
screen was migrated off emoji glyphs. Match that for new UI instead of reintroducing
emoji.

## Git workflow

`main` and `develop` are the only long-lived branches. Every change — feature, fix,
chore, anything — gets its own branch off `develop`, named `FIX/<what-it-does-in-english>`
(kebab-case, e.g. `FIX/add-lucide-icons`, `FIX/group-totals-sync`), regardless of
whether the change is actually a bug fix — `FIX/` is the fixed prefix for all of them.

Work happens on that branch, then opens a real GitHub pull request into `develop`
(`gh pr create`) — no direct merges. The PR body has a `## Summary` section, written
as a tidy summary of what changed, not a raw diff dump. The PR is left for merging
(by the user or a reviewer), not merged automatically as part of doing the work.
`develop` is promoted to `main` afterward, as its own separate, deliberate step — not
per-branch/per-PR.

## Conventions

The product is Brazilian Portuguese: UI strings, code comments and doc comments are
written in pt-BR, and comments explain *why* a decision was made (especially where an
API limitation forced it). Match that when editing.
