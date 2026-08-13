# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The application lives entirely in `sasi-checklist/` — the only directory with
`package.json`, `node_modules` and `.env.local`. The repository root holds just
`CLAUDE.md`, `README.md` and the git config files.

A duplicated copy of `src/` used to sit at the root, along with its own
`next.config.ts`, `postcss.config.js`, `tailwind.config.ts` and `package-lock.json`.
It was residue from an older layout and has been deleted; do not recreate it.

**All commands below must run from `sasi-checklist/`.**

## Commands

```bash
cd sasi-checklist
npm install
npm run dev        # next dev
npm run build      # next build
npm run lint       # eslint .
npm run db:seed    # npx tsx src/lib/seed.ts — populates activities in Turso
```

There is no test suite and no test runner configured.

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

The config is `sasi-checklist/next.config.js` (CommonJS). It sets
`outputFileTracingRoot: __dirname`, which dates from the duplicated tree described
above — it kept Next's file tracing from wandering into the root copy.

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
   `/api/cgc/history`. Groups themselves are read-only from the UI (seeded via
   `db:seed` or created directly through the API) — the selection screen has no
   create/edit/delete affordance, only "Abrir", and always renders the four seeded
   groups in the fixed order CGC, NUPPAE, NGOA, CIPA (unknown groups sort last).

Every page is a client component (`"use client"`) that fetches its own `/api/...`
route. No server components fetch data, and no page talks to the SASI API directly —
the API token never reaches the browser.

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

There are two implementations of `requireAuth`, both reading the token through
`readSasiTokenHeader` (never from the URL) so the rule above cannot drift between
them: `src/lib/api-auth.ts` (shared, also returns the raw token so it can be forwarded
as Bearer to the SASI API) used by the CGC routes, and a private per-file copy inside
the older checklist routes (`/api/activities`, `/api/checklists`, `/api/observations`,
`/api/history`).

### Database

`src/lib/db.ts` holds a lazy singleton client plus `initDb()`, which creates every
table with `CREATE TABLE IF NOT EXISTS` and migrates older schemas via `ALTER TABLE`
wrapped in `try/catch` (a thrown "duplicate column" is the "already migrated" signal).
`initDb()` is called at the top of route handlers — there is no migration tool.

Tables: `checklists`, `activities`, `history`, `observations`, `completed_checklists`,
`completed_checklist_items`, and the CGC-only `cgc_groups`, `cgc_activity_status`,
`cgc_history`, `cgc_observations`, `cgc_group_totals`.

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
  This is a *different* credential than the personal `sasi-token` used to log into the
  app (validated against `AUTH_USER_ENDPOINT`, a different host): `resolveSasiToken`
  therefore prefers `SASI_API_TOKEN` from `.env.local` over the user's own token —
  the user's token authenticates them locally but is not accepted by the Bone API.
- There is no deadline/SLA field anywhere in the spec, and `raw.priority` is a boolean.
  Both the deadline and the real priority are read out of the dynamic `data_fields[]`.
- Messages come back newest-first (highest `id`/`created_at` on page 1) — confirmed
  empirically against channel `33397`, not documented in the spec. `group-totals.ts`
  (below) depends on this holding.

A **group** (`cgc_groups`) is a local entity, not an API concept: it stores filters under
the exact query-param names of `/provider/messages` (`category_ids`, `team_name`,
`channel_ids`, `app_ids`). The four seeded groups (CGC, NGOA, NUPPAE, CIPA) all read the
same channel `33397`; what separates them is `data_field_value`, a value *inside* the
message. Since the API cannot filter by form content, `/api/cgc/activities` scans pages
server-side up to `SASI_CGC_SCAN_CAP` (default 500) and filters after mapping.

`src/lib/cgc/group-totals.ts` keeps the "solicitadas" count shown on the group
selection screen in sync with the API, without rescanning on every load: it persists
`total` and `last_message_id` per group in `cgc_group_totals`, and on each sync only
fetches pages newer than that high-water mark (stopping as soon as a page has nothing
new), then re-checks only after a 2-minute TTL. Groups sharing the same base query
(all four seeded ones share channel `33397`) are scanned together in one pass instead
of one scan per group. Known gap: this only detects new messages, not deleted ones —
the total never shrinks on its own.

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
parallel palette. `src/lib/cgc/colors.ts` layers a fixed brand color per seeded group
(`getCgcGroupColor`: CGC `#004AAD`, NUPPAE `#FF3131`, NGOA `#FF751F`, CIPA `#457A00`) on
top of `getCategoryColor`'s hash-based fallback for anything else.

### Styling

Screens are styled with inline styles, so media queries cannot live there. All
responsive behavior sits in named classes in `src/app/globals.css`
(`.app-header-inner`, `.app-nav`, `.split-card`, `.card-actions`, `.two-col`,
`.field-row`, `.import-row`). Add responsive rules there, not inline.

Icons are `lucide-react` components (e.g. `<Search size={14} />`), not emoji — every
screen was migrated off emoji glyphs. Match that for new UI instead of reintroducing
emoji.

## Conventions

The product is Brazilian Portuguese: UI strings, code comments and doc comments are
written in pt-BR, and comments explain *why* a decision was made (especially where an
API limitation forced it). Match that when editing.
