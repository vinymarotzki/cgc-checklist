# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The application lives at the repository root: `package.json`, `src/` and
`.env.local` are all first-level. Vercel builds with the default Root Directory,
so keeping `package.json` at the root is what makes the deploy find Next.js.

## Commands

```bash
npm install
npm run dev        # next dev
npm run build      # next build
npm run lint       # eslint .
npm run db:seed    # npx tsx src/lib/seed.ts — populates activities in Turso
```

There is no test suite and no test runner configured.

`db:seed` uses `@next/env` `loadEnvConfig`, so it reads the same `.env.local` as the
app; pointing it at the production database is done by swapping env vars, not by a flag.

Local access always needs the token in the URL, e.g.
`http://localhost:3000/?sasi-token=TOKEN` (see "Auth" — localhost has a bypass).

## Stack

Next.js 16 (App Router) + React 19 + TypeScript strict, Tailwind 3, Turso/libSQL
(`@libsql/client`), `xlsx` for spreadsheet export, deployed on Vercel. Path alias
`@/*` maps to `src/*`.

`next.config.js` (CommonJS) is the config actually used; it sets
`outputFileTracingRoot: __dirname` so tracing stays inside this directory.

## Architecture

Two independent products live in the same app and share only the status vocabulary
and the auth pattern:

1. **Checklist de Simulados** — activities stored in Turso, fully owned locally.
   Routes: `/` (the checklist itself — there is *no* `/checklist` route),
   `/checklists` (list), `/admin` (edit activities/categories), `/history`.
   API: `/api/checklists`, `/api/activities`, `/api/observations`, `/api/history`.
2. **Atividades do CGC** — read-only mirror of messages coming from the external
   SASI ("Bone") API, with status/comments/history kept locally because the API
   token cannot write. Routes: `/atividades-cgc`, `/atividades-cgc/historico`.
   API: `/api/cgc/groups`, `/api/cgc/activities`, `/api/cgc/observations`,
   `/api/cgc/history`.

Every page is a client component (`"use client"`) that fetches its own `/api/...`
route. No server components fetch data, and no page talks to the SASI API directly —
the API token never reaches the browser.

### Auth

Token arrives as `?sasi-token=` (or `?token=`) in the URL and must be propagated by
hand into every internal link and every `fetch` — pages build a `buildQuery()`/
`authQuery` string for this. Server side, `authenticateToken` (`src/lib/auth.ts`)
validates it against `AUTH_USER_ENDPOINT`.

`AUTH_USER_ENDPOINT` is typically absent from `.env.local`, which makes
`authenticateToken` reject *every* token. Local development only works because of the
localhost host bypass in `requireAuth`, which fabricates a `{ id: "local", name: "Local" }`
user.

There are two implementations of `requireAuth`: `src/lib/api-auth.ts` (shared, also
returns the raw token so it can be forwarded as Bearer to the SASI API) used by the
CGC routes, and a private per-file copy inside the older checklist routes
(`/api/activities`, `/api/checklists`, …). The duplication is deliberate — the CGC
work did not touch the checklist routes.

### Database

`src/lib/db.ts` holds a lazy singleton client plus `initDb()`, which creates every
table with `CREATE TABLE IF NOT EXISTS` and migrates older schemas via `ALTER TABLE`
wrapped in `try/catch` (a thrown "duplicate column" is the "already migrated" signal).
`initDb()` is called at the top of route handlers — there is no migration tool.

Tables: `checklists`, `activities`, `history`, `observations`, `completed_checklists`,
`completed_checklist_items`, and the CGC-only `cgc_groups`, `cgc_activity_status`,
`cgc_history`, `cgc_observations`.

The CGC tables are separate from the checklist ones on purpose: `/api/observations`
writes to `history`, and `/api/history` does a `LEFT JOIN activities`, so a CGC comment
routed through them would become an orphan row on the checklist history screen.
`cgc_history` is denormalized on purpose (it stores group/description/priority/deadline
alongside the change) because the source message lives in the SASI API and can leave the
query window.

### SASI API integration (`src/lib/sasi-api/`, `src/lib/cgc/`)

`src/lib/sasi-api/client.ts` is the single network layer — nothing else may build a URL
or auth header for `api.bone.sasi.io`. Contract facts that constrain the code:

- Base URL has **no** `/api` prefix; the machine-readable spec is at `/api-json`.
- `GET /provider/messages` returns a **bare array**, no envelope and no total; the total
  comes from a separate `GET /provider/messages/count`.
- `limit` maxes at 100 (default 10), `page` is 1-based.
- The provider token (`pat_`, scope `READ_MESSAGES`) is accepted **only** on
  `/provider/messages*`; `/provider/statuses`, `/categories`, `/channels` return 401.
- There is no deadline/SLA field anywhere in the spec, and `raw.priority` is a boolean.
  Both the deadline and the real priority are read out of the dynamic `data_fields[]`.

A **group** (`cgc_groups`) is a local entity, not an API concept: it stores filters under
the exact query-param names of `/provider/messages` (`category_ids`, `team_name`,
`channel_ids`, `app_ids`). The four seeded groups (CGC, NGOA, NUPPAE, CIPA) all read the
same channel `33397`; what separates them is `data_field_value`, a value *inside* the
message. Since the API cannot filter by form content, `/api/cgc/activities` scans pages
server-side up to `SASI_CGC_SCAN_CAP` (default 500) and filters after mapping.

Field names for channel 33397 are pinned in `src/lib/cgc/field-map.ts`
(`selecione_time` → group, `prioridades` → priority, `prazo_de_entrega` → deadline,
`descreva` → description) and overridable by env so a rename does not need a deploy.
`src/lib/cgc/mapper.ts` must never throw on missing or unexpected data — a missing field
becomes `null` and the UI shows an empty state. Do **not** surface `profileFields`: it
carries the sender's phone, e-mail and birth date.

Status for CGC activities is local (`cgc_activity_status`, keyed by SASI message id,
default `NAO_INICIADO`) because `READ_MESSAGES` cannot write; the SASI-side status is
mapped to the same vocabulary in `CgcActivity.sasiStatus` and is informational only.
`recordHistory` swallows exceptions by design so history writes can never block a status
change or comment — the cost is that a failed write is silent.

The CGC list auto-refreshes every 15s (`REFRESH_INTERVAL_MS`) and on tab focus; combined
with field routing this repeats the page scan, so raise the interval if it becomes costly.

### Status vocabulary

`src/lib/checklist-status.ts` is the single source for statuses and their colors, shared
by both products: `SEM_STATUS`, `NAO_INICIADO`, `EM_ANDAMENTO`, `CONCLUIDO`, `IMPEDIDO`
(only the middle three are offered in the selector). Reuse it rather than defining a
parallel palette.

### Styling

Screens are styled with inline styles, so media queries cannot live there. All
responsive behavior sits in named classes in `src/app/globals.css`
(`.app-header-inner`, `.app-nav`, `.split-card`, `.card-actions`, `.two-col`,
`.field-row`, `.import-row`). Add responsive rules there, not inline.

## Conventions

The product is Brazilian Portuguese: UI strings, code comments and doc comments are
written in pt-BR, and comments explain *why* a decision was made (especially where an
API limitation forced it). Match that when editing.
