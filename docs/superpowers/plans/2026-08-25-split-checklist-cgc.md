# Separação Checklist / CGC em Dois Sistemas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar "Checklist de Simulados" e "Atividades do CGC" — hoje um único app Next.js — em dois repositórios independentes (`sasi-checklist` e `sasi-cgc`), cada um com seu próprio banco Turso e seu próprio container Docker, mantendo o painel `/controle` funcional via chamada HTTP entre os dois.

**Architecture:** `sasi-cgc` nasce como cópia do código hoje em `src/lib/cgc/`, `src/lib/sasi-api/`, `src/app/atividades-cgc/`, `src/app/api/cgc/*`, mais as duas rotas `/api/controle/cgc*` (que migram pra lá). `sasi-checklist` (este repo) perde esse código e ganha duas rotas-proxy no lugar, que repassam a chamada pro `sasi-cgc` via `CGC_APP_URL`. Autenticação (`token.ts`/`auth.ts`) e vocabulário de status (`checklist-status.ts`) são pequenos o bastante pra virar cópias independentes em cada repo, em vez de um pacote compartilhado.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict, Turso/libSQL (`@libsql/client`), Docker (Node 24-alpine, multi-stage), Turso CLI/dashboard para o banco novo.

**Spec:** `docs/superpowers/specs/2026-08-25-split-checklist-cgc-design.md`

## Global Constraints

- Sem suite de testes automatizada neste projeto (nenhum dos dois repos) —
  verificação de cada task é `npm run build`, `npm run lint` e checagem manual
  via `curl`/navegador, não `pytest`/`jest`.
- Comentários de código em pt-BR, só onde o "porquê" não é óbvio — sem
  comentário nenhum quando o código já se explica (convenção do CLAUDE.md).
- `sasi-cgc` roda em `:3001`; `sasi-checklist` continua em `:3000`.
- `output: "standalone"` no `next.config.js` dos dois repos; Dockerfile
  multi-stage `deps → dev|builder → runner`, `node:24-alpine`.
- Modo dev usa `next dev --webpack` (não Turbopack) + `WATCHPACK_POLLING=true`
  no `next.config.js` — bind mount Windows→WSL2 do Docker Desktop não propaga
  eventos de arquivo sem polling (validado nesta sessão).
- `CGC_APP_URL` é uma env var **server-only**: nunca prefixada `NEXT_PUBLIC_`,
  nunca lida em código `"use client"`.
- As tabelas `cgc_*` reais são **sete**, não cinco: `cgc_groups`,
  `cgc_activity_status`, `cgc_history`, `cgc_observations`,
  `cgc_group_totals`, `cgc_message_cache`, `cgc_message_cache_sync` (as duas
  últimas não estavam listadas no CLAUDE.md original, confirmado lendo
  `src/lib/db.ts`).
- Nenhum comando destrutivo (`DROP TABLE`, apagar banco antigo) roda como
  parte automática de uma task — Task 15 é explicitamente gated e só deve
  rodar depois de confirmação do usuário, com os dois sistemas já validados
  rodando de forma independente.

---

## Contexto de arquivos (levantado nesta sessão)

Arquivos que vão para `sasi-cgc` (cópia ou movimentação):
- `src/lib/cgc/*.ts` (9 arquivos: `colors.ts`, `field-map.ts`,
  `group-totals.ts`, `groups.ts`, `status-store.ts`, `history.ts`,
  `mapper.ts`, `types.ts`, `message-cache.ts`)
- `src/lib/sasi-api/*.ts` (4 arquivos: `client.ts`, `messages.ts`,
  `types.ts`, `notify.ts`)
- `src/lib/api-auth.ts` (só usado pelas rotas `/api/cgc/*` — confirmado via
  grep, nenhuma rota do checklist importa)
- `src/app/atividades-cgc/page.tsx`, `src/app/atividades-cgc/historico/page.tsx`
- `src/app/api/cgc/{groups,activities,history,observations,cron-sync,webhook}/route.ts`
- `src/app/api/controle/cgc/route.ts`, `src/app/api/controle/cgc/activities/route.ts`
  (movidas — viram as rotas reais; `sasi-checklist` fica só com o proxy)

Arquivos duplicados (cada repo mantém sua própria cópia, editável
independentemente a partir de agora):
- `src/lib/token.ts`, `src/lib/auth.ts`, `src/hooks/useSasiToken.ts`
- `src/lib/checklist-status.ts`, `src/lib/utils.ts` (função `cn`)
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/icon.svg`

Confirmado nesta sessão: **não existe link cruzado hoje** entre as páginas do
Checklist e as do CGC (grep em `href=` nas duas árvores não encontrou
nenhuma). Nenhuma mudança de navegação é necessária.

---

## Task 1: Provisionar banco Turso novo para o CGC

**Ação manual do usuário** — precisa da conta/CLI Turso do usuário, não pode
ser automatizada por um agente sem essas credenciais.

**Files:** nenhum (infraestrutura externa)

- [ ] **Passo 1: Criar o banco**

Se tiver a Turso CLI instalada (`turso --version`; se não tiver,
`curl -sSfL https://get.tur.so/install.sh | bash` ou via
`scoop install turso` no Windows):

```bash
turso db create sasi-cgc
turso db show sasi-cgc --url
turso db tokens create sasi-cgc
```

Sem CLI, o mesmo dá pra fazer pelo dashboard em `https://app.turso.tech` →
"Create Database", nome `sasi-cgc`, depois "Create Token" na aba do banco.

- [ ] **Passo 2: Guardar as credenciais**

Anotar a URL (`libsql://sasi-cgc-<org>.turso.io`) e o token gerado — vão
entrar no `.env.local` do `sasi-cgc` na Task 3, e como `SOURCE_`/`DEST_`
na Task 2 (migração).

- [ ] **Checkpoint:** confirmar acesso rodando
  `turso db shell sasi-cgc "SELECT 1"` (ou testar a URL/token com o script
  da Task 2 em modo leitura) antes de seguir.

---

## Task 2: Script de migração de dados `cgc_*`

Script standalone (mesmo padrão de `query_db.mjs`, já existente no repo:
`node script.mjs`, sem framework), migra as sete tabelas `cgc_*` do banco
atual pro banco novo. **Não roda ainda** — só é escrito e testado em modo
dry-run nesta task; a execução real (Task 15) é gated.

**Files:**
- Create: `scripts/migrate-cgc-data.mjs`

- [ ] **Passo 1: Escrever o script**

```javascript
// scripts/migrate-cgc-data.mjs
//
// Copia as tabelas cgc_* do banco Turso de origem (checklist, hoje com
// tudo junto) pro banco Turso de destino (sasi-cgc, novo). Idempotente:
// usa INSERT OR REPLACE, então pode rodar de novo sem duplicar linhas.
//
// Uso:
//   SOURCE_TURSO_DATABASE_URL=... SOURCE_TURSO_AUTH_TOKEN=... \
//   DEST_TURSO_DATABASE_URL=...   DEST_TURSO_AUTH_TOKEN=...   \
//   node scripts/migrate-cgc-data.mjs [--dry-run]

import { createClient } from "@libsql/client";

const dryRun = process.argv.includes("--dry-run");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida`);
  return value;
}

const source = createClient({
  url: requireEnv("SOURCE_TURSO_DATABASE_URL"),
  authToken: process.env.SOURCE_TURSO_AUTH_TOKEN || undefined,
});

const dest = createClient({
  url: requireEnv("DEST_TURSO_DATABASE_URL"),
  authToken: process.env.DEST_TURSO_AUTH_TOKEN || undefined,
});

// Ordem sem relevância de FK (nenhuma tabela cgc_* tem FOREIGN KEY), mas
// mantida na ordem de criação de src/lib/db.ts por clareza.
const TABLES = [
  "cgc_groups",
  "cgc_activity_status",
  "cgc_history",
  "cgc_observations",
  "cgc_group_totals",
  "cgc_message_cache",
  "cgc_message_cache_sync",
];

async function migrateTable(table) {
  const { rows, columns } = await source.execute(`SELECT * FROM ${table}`);
  if (rows.length === 0) {
    console.log(`${table}: 0 linhas na origem, nada a copiar.`);
    return { table, source: 0, dest: 0 };
  }

  if (!dryRun) {
    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`;
    for (const row of rows) {
      await dest.execute({ sql, args: columns.map((col) => row[col]) });
    }
  }

  const destCount = dryRun
    ? null
    : (await dest.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n;

  console.log(
    `${table}: ${rows.length} linhas na origem` +
      (dryRun ? " (dry-run, nada gravado)" : `, ${destCount} no destino após migração`)
  );
  return { table, source: rows.length, dest: destCount };
}

const results = [];
for (const table of TABLES) {
  results.push(await migrateTable(table));
}

if (!dryRun) {
  const mismatched = results.filter((r) => r.source !== r.dest);
  if (mismatched.length > 0) {
    console.error("Contagens não batem:", mismatched);
    process.exitCode = 1;
  } else {
    console.log("Todas as contagens batem entre origem e destino.");
  }
}
```

- [ ] **Passo 2: Testar em dry-run contra o banco atual e o banco novo**

O destino (`sasi-cgc`) ainda não tem as tabelas `cgc_*` criadas nesse
ponto do plano — isso só acontece na Task 8, quando o `initDb()` do
`sasi-cgc` roda pela primeira vez. Por isso o dry-run aqui só lê a
origem; não é possível testar a escrita real ainda.

```bash
SOURCE_TURSO_DATABASE_URL="<url do banco atual>" \
SOURCE_TURSO_AUTH_TOKEN="<token do banco atual>" \
DEST_TURSO_DATABASE_URL="<url do sasi-cgc>" \
DEST_TURSO_AUTH_TOKEN="<token do sasi-cgc>" \
node scripts/migrate-cgc-data.mjs --dry-run
```

Esperado: uma linha por tabela com a contagem de origem, sem erro de
conexão nas duas pontas.

- [ ] **Passo 3: Commit**

```bash
git add scripts/migrate-cgc-data.mjs
git commit -m "chore: adiciona script de migracao das tabelas cgc_* pro banco novo"
```

---

## Task 3: Scaffold do repositório `sasi-cgc`

Cria a pasta irmã `../sasi-cgc` com toda a configuração de projeto (sem
código de produto ainda — isso vem nas Tasks 4-7).

**Files (todos em `sasi-cgc/`, repo novo):**
- Create: `package.json`, `tsconfig.json`, `next.config.js`,
  `tailwind.config.ts`, `postcss.config.js`, `eslint.config.mjs`,
  `components.json`, `.gitignore`, `.env.example`

- [ ] **Passo 1: Criar a pasta e inicializar o git**

```bash
mkdir -p "../sasi-cgc/src"
cd "../sasi-cgc"
git init
```

- [ ] **Passo 2: `package.json`**

Mesma stack do `sasi-checklist`, sem `xlsx` (só usado por `/controle`, que
fica no outro repo) nem `@types/better-sqlite3` (dependência não usada em
nenhum dos dois repos hoje).

```json
{
  "name": "sasi-cgc",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "@base-ui/react": "^1.7.0",
    "@libsql/client": "^0.14.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.31.0",
    "next": "^16.2.9",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "shadcn": "^4.18.0",
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/uuid": "^10",
    "autoprefixer": "^10",
    "eslint": "^9.39.4",
    "eslint-config-next": "^16.2.9",
    "postcss": "^8",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}
```

- [ ] **Passo 3: copiar configs genéricas sem alteração do `sasi-checklist`**

```bash
cp ../sasi-checklist/tsconfig.json .
cp ../sasi-checklist/tailwind.config.ts .
cp ../sasi-checklist/postcss.config.js .
cp ../sasi-checklist/eslint.config.mjs .
cp ../sasi-checklist/components.json .
cp ../sasi-checklist/.gitignore .
```

- [ ] **Passo 4: `next.config.js`** (idêntico ao do `sasi-checklist` — polling
  condicional já validado nesta sessão)

```javascript
const nextConfig = {
  output: "standalone",
  // Bind mount do Windows para o WSL2 do Docker Desktop não propaga eventos
  // de arquivo (inotify), só polling detecta as mudanças pra hot-reload.
  ...(process.env.WATCHPACK_POLLING === "true" && {
    webpack: (config) => {
      config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
      return config;
    },
  }),
};

module.exports = nextConfig;
```

- [ ] **Passo 5: `.env.example`**

```bash
# Banco (Turso / libSQL) — banco PRÓPRIO do sasi-cgc, não o do checklist.
TURSO_DATABASE_URL=libsql://exemplo.turso.io
TURSO_AUTH_TOKEN=

# Validação do sasi-token da URL — mesmo AUTH_USER_ENDPOINT do sasi-checklist,
# os dois validam contra o mesmo serviço externo de login.
AUTH_USER_ENDPOINT=

# --- API SASI (Bone) ---

# Token da API SASI usado em desenvolvimento, quando não há sasi-token na URL.
# Criado em POST /provider/api-tokens com escopo READ_MESSAGES.
SASI_API_TOKEN=

# Opcionais — os defaults já apontam para a API de produção.
# SASI_API_BASE_URL=https://api.bone.sasi.io
# SASI_API_TIMEOUT_MS=15000
# SASI_CGC_SCAN_CAP=500
# SASI_CGC_FIELD_GROUP=selecione_time
# SASI_CGC_FIELD_PRIORITY=prioridades
# SASI_CGC_FIELD_DEADLINE=prazo_de_entrega
# SASI_CGC_FIELD_DESCRIPTION=descreva
```

- [ ] **Passo 6: `.env.local` de verdade** (não versionado — copiar do
  `.env.example` e preencher com os valores da Task 1)

```bash
cp .env.example .env.local
```

Editar `.env.local` preenchendo `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` com
o banco criado na Task 1, e `AUTH_USER_ENDPOINT`/`SASI_API_TOKEN` copiando
os mesmos valores do `.env.local` do `sasi-checklist`.

- [ ] **Passo 7: Commit**

```bash
git add package.json tsconfig.json tailwind.config.ts postcss.config.js eslint.config.mjs components.json .gitignore next.config.js .env.example
git commit -m "chore: scaffold inicial do repositorio sasi-cgc"
```

---

## Task 4: Copiar código duplicado (auth, status, utils) para `sasi-cgc`

**Files (em `sasi-cgc/`):**
- Create: `src/lib/token.ts`, `src/lib/auth.ts`, `src/lib/checklist-status.ts`,
  `src/lib/utils.ts`, `src/hooks/useSasiToken.ts`, `src/app/layout.tsx`,
  `src/app/globals.css`, `src/app/icon.svg`

- [ ] **Passo 1: Copiar sem alteração**

```bash
mkdir -p src/lib src/hooks src/app
cp ../sasi-checklist/src/lib/token.ts src/lib/token.ts
cp ../sasi-checklist/src/lib/auth.ts src/lib/auth.ts
cp ../sasi-checklist/src/lib/checklist-status.ts src/lib/checklist-status.ts
cp ../sasi-checklist/src/lib/utils.ts src/lib/utils.ts
cp ../sasi-checklist/src/hooks/useSasiToken.ts src/hooks/useSasiToken.ts
cp ../sasi-checklist/src/app/globals.css src/app/globals.css
cp ../sasi-checklist/src/app/icon.svg src/app/icon.svg
cp ../sasi-checklist/src/app/layout.tsx src/app/layout.tsx
```

- [ ] **Passo 2: Ajustar o título em `src/app/layout.tsx`**

Trocar (é a única diferença do original):

```tsx
export const metadata: Metadata = {
  title: "Checklist de Simulados",
  description: "Sistema de Acompanhamento de Simulados Institucionais",
};
```

por:

```tsx
export const metadata: Metadata = {
  title: "Atividades do CGC",
  description: "Acompanhamento das atividades do CGC (SASI/Bone)",
};
```

- [ ] **Passo 3: Commit**

```bash
git add src/lib/token.ts src/lib/auth.ts src/lib/checklist-status.ts src/lib/utils.ts src/hooks/useSasiToken.ts src/app/layout.tsx src/app/globals.css src/app/icon.svg
git commit -m "feat: copia auth, vocabulario de status e layout base pro sasi-cgc"
```

---

## Task 5: Código próprio do CGC + banco de dados do `sasi-cgc`

**Files (em `sasi-cgc/`):**
- Create: `src/lib/cgc/*.ts` (9 arquivos), `src/lib/sasi-api/*.ts` (4
  arquivos), `src/lib/api-auth.ts`, `src/lib/db.ts`

**Interfaces:**
- Produz: `getDb()`, `initDb()` de `src/lib/db.ts` — mesma assinatura do
  `sasi-checklist`, usados por todas as rotas da Task 6.

- [ ] **Passo 1: Copiar `src/lib/cgc/` e `src/lib/sasi-api/` sem alteração**

```bash
mkdir -p src/lib/cgc src/lib/sasi-api
cp ../sasi-checklist/src/lib/cgc/*.ts src/lib/cgc/
cp ../sasi-checklist/src/lib/sasi-api/*.ts src/lib/sasi-api/
cp ../sasi-checklist/src/lib/api-auth.ts src/lib/api-auth.ts
```

- [ ] **Passo 2: `src/lib/db.ts` — só as tabelas `cgc_*`**

Mesmo padrão de memoização do original (`initDb`/`dbReadyPromise`), mas
`runMigrations` cria só as sete tabelas do CGC — nada de `checklists`,
`activities`, `history`, `observations`, `completed_checklists`,
`completed_checklist_items`.

```typescript
import { createClient } from "@libsql/client";

let client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not defined");
    }

    client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return client;
}

async function runMigrations() {
  const db = getDb();

  // Grupos das Atividades do CGC. Guarda só o recorte de filtros repassado a
  // GET /provider/messages da API SASI. As colunas de filtro usam os mesmos
  // nomes dos query params do contrato. data_field_name/data_field_value não
  // são params da API: são o roteamento por campo da própria mensagem,
  // aplicado depois do mapeamento.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_ids TEXT,
      team_name TEXT,
      channel_ids TEXT,
      app_ids TEXT,
      data_field_name TEXT,
      data_field_value TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  for (const column of ["data_field_name", "data_field_value"]) {
    try {
      await db.execute(`ALTER TABLE cgc_groups ADD COLUMN ${column} TEXT`);
    } catch {
      // Coluna já existe em schema mais antigo, ignora.
    }
  }

  // Status das Atividades do CGC. O token de provider da API SASI só tem
  // escopo READ_MESSAGES, então o status é acompanhado aqui. A chave é o id
  // da mensagem na API SASI.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_activity_status (
      message_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      group_id TEXT,
      user_id TEXT,
      user_name TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  try {
    await db.execute(`ALTER TABLE cgc_activity_status ADD COLUMN group_id TEXT`);
  } catch {
    // Coluna já existe em schema mais antigo, ignora.
  }

  // Histórico das Atividades do CGC. Denormalizado de propósito: a mensagem
  // original vive na API SASI e pode mudar ou sair da janela de consulta,
  // então cada entrada guarda o retrato do que foi alterado.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_history (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      group_id TEXT,
      group_name TEXT,
      description TEXT,
      priority TEXT,
      deadline TEXT,
      old_status TEXT,
      new_status TEXT,
      observation TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_history_created ON cgc_history (created_at DESC)`
  );

  // Comentários das Atividades do CGC.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_observations (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_observations_message ON cgc_observations (message_id)`
  );

  // Total "solicitado" por grupo, sincronizado da API SASI (ver
  // group-totals.ts). last_message_id é a marca d'água: só mensagens mais
  // novas que ela entram na próxima sincronização.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_group_totals (
      group_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      last_message_id INTEGER,
      updated_at TEXT NOT NULL
    )
  `);

  // Cache local das atividades do CGC já mapeadas (ver message-cache.ts).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache (
      message_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_message_cache_group ON cgc_message_cache (group_id)`
  );

  // Marca d'água + TTL da sincronização do cache acima. Tabela própria (em
  // vez de reusar cgc_group_totals) porque a contagem "solicitada" da tela
  // de seleção e o cache de atividades têm cadências diferentes.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache_sync (
      group_id TEXT PRIMARY KEY,
      last_message_id INTEGER,
      synced_at TEXT NOT NULL
    )
  `);
}

let dbReadyPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!dbReadyPromise) {
    dbReadyPromise = runMigrations().catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}
```

- [ ] **Passo 3: Commit**

```bash
git add src/lib/cgc src/lib/sasi-api src/lib/api-auth.ts src/lib/db.ts
git commit -m "feat: adiciona codigo proprio do CGC e banco (so tabelas cgc_*)"
```

---

## Task 6: Páginas e rotas de API do CGC em `sasi-cgc`

**Files (em `sasi-cgc/`):**
- Create: `src/app/atividades-cgc/page.tsx`,
  `src/app/atividades-cgc/historico/page.tsx`,
  `src/app/api/cgc/groups/route.ts`, `src/app/api/cgc/activities/route.ts`,
  `src/app/api/cgc/history/route.ts`, `src/app/api/cgc/observations/route.ts`,
  `src/app/api/cgc/cron-sync/route.ts`, `src/app/api/cgc/webhook/route.ts`,
  `src/app/api/controle/cgc/route.ts`,
  `src/app/api/controle/cgc/activities/route.ts`

**Interfaces:**
- Consome: `getDb`/`initDb` de `src/lib/db.ts` (Task 5), `requireAuth` de
  `src/lib/api-auth.ts` (Task 5), tudo de `src/lib/cgc/*` e
  `src/lib/sasi-api/*` (Task 5).

- [ ] **Passo 1: Copiar sem alteração — nenhum desses arquivos importa nada
  fora do que já foi copiado nas Tasks 4 e 5**

```bash
mkdir -p src/app/atividades-cgc/historico
mkdir -p src/app/api/cgc/{groups,activities,history,observations,cron-sync,webhook}
mkdir -p src/app/api/controle/cgc/activities

cp ../sasi-checklist/src/app/atividades-cgc/page.tsx src/app/atividades-cgc/page.tsx
cp ../sasi-checklist/src/app/atividades-cgc/historico/page.tsx src/app/atividades-cgc/historico/page.tsx

cp ../sasi-checklist/src/app/api/cgc/groups/route.ts src/app/api/cgc/groups/route.ts
cp ../sasi-checklist/src/app/api/cgc/activities/route.ts src/app/api/cgc/activities/route.ts
cp ../sasi-checklist/src/app/api/cgc/history/route.ts src/app/api/cgc/history/route.ts
cp ../sasi-checklist/src/app/api/cgc/observations/route.ts src/app/api/cgc/observations/route.ts
cp ../sasi-checklist/src/app/api/cgc/cron-sync/route.ts src/app/api/cgc/cron-sync/route.ts
cp ../sasi-checklist/src/app/api/cgc/webhook/route.ts src/app/api/cgc/webhook/route.ts

cp ../sasi-checklist/src/app/api/controle/cgc/route.ts src/app/api/controle/cgc/route.ts
cp ../sasi-checklist/src/app/api/controle/cgc/activities/route.ts src/app/api/controle/cgc/activities/route.ts
```

- [ ] **Passo 2: Criar `src/app/page.tsx` raiz** (o `sasi-cgc` não tem rota
  `/` própria hoje — redireciona pra `/atividades-cgc` pra não deixar a raiz
  em 404)

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/atividades-cgc");
}
```

- [ ] **Passo 3: Commit**

```bash
git add src/app/atividades-cgc src/app/api/cgc src/app/api/controle src/app/page.tsx
git commit -m "feat: adiciona paginas e rotas das atividades do CGC"
```

---

## Task 7: Docker para `sasi-cgc`

**Files (em `sasi-cgc/`):**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `public/.gitkeep`

- [ ] **Passo 1: `public/` (placeholder — Next standalone exige a pasta)**

```bash
mkdir -p public
touch public/.gitkeep
```

- [ ] **Passo 2: `.dockerignore`** (idêntico ao `sasi-checklist`)

```
node_modules
.next
.git
.env.local
.env
*.db
*.tsbuildinfo
*.log
```

- [ ] **Passo 3: `Dockerfile`** (idêntico ao `sasi-checklist`, mesmo padrão
  multi-stage validado nesta sessão)

```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "--webpack"]

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
```

- [ ] **Passo 4: `docker-compose.yml`** (porta `3001` no host, `3000` dentro
  do container — evita conflito rodando junto com o `sasi-checklist`)

```yaml
services:
  app:
    build: .
    ports:
      - "3001:3000"
    env_file:
      - .env.local
    profiles:
      - prod

  dev:
    build:
      context: .
      target: dev
    ports:
      - "3001:3000"
    env_file:
      - .env.local
    environment:
      - WATCHPACK_POLLING=true
    volumes:
      - .:/app
      - /app/node_modules
      - /app/.next
    profiles:
      - dev
```

- [ ] **Passo 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore public/.gitkeep
git commit -m "chore: adiciona Docker (dev/prod) pro sasi-cgc"
```

---

## Task 8: Validar `sasi-cgc` rodando sozinho

**Files:** nenhum novo — só validação do que as Tasks 3-7 produziram.

- [ ] **Passo 1: Instalar dependências e checar build/lint**

```bash
cd ../sasi-cgc
npm install
npm run lint
npm run build
```

Esperado: `npm run build` conclui sem erro de TypeScript, gera
`.next/standalone`. Se `npm run lint` apontar algo, corrigir antes de
seguir — mesmo padrão de qualidade do `sasi-checklist`.

- [ ] **Passo 2: Subir via Docker Desktop (modo dev) e testar**

```bash
docker compose --profile dev up -d --build
```

Aguardar alguns segundos e testar (o `.env.local` da Task 3 já precisa ter
`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` do banco novo e
`AUTH_USER_ENDPOINT` preenchidos):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/atividades-cgc?sasi-token=SEU_TOKEN"
```

Esperado: `200`. Isso também valida que `initDb()` conseguiu criar as sete
tabelas `cgc_*` no banco novo (primeira chamada de rota que usa `getDb`).

- [ ] **Passo 3: Conferir que as tabelas foram criadas no banco novo**

```bash
node -e "
import('@libsql/client').then(async ({ createClient }) => {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const r = await db.execute(\"SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'cgc_%' ORDER BY name\");
  console.log(r.rows);
});
"
```

Esperado: as sete tabelas listadas.

- [ ] **Passo 4: Parar o container**

```bash
docker compose --profile dev down
```

---

## Task 9: Commit final de scaffold do `sasi-cgc`

**Files:** nenhum novo — task de fechamento, sem passos de código.

- [ ] **Passo 1: Conferir `git status` limpo (sem sobra de arquivo gerado)**

```bash
cd ../sasi-cgc
git status --short
```

Esperado: só `next-env.d.ts` (gerado pelo `npm run build`/`dev`, ok deixar
de fora do commit se o `.gitignore` copiado da Task 3 já ignora build
artifacts — conferir e ajustar `.gitignore` se necessário).

- [ ] **Passo 2: Confirmar que o repo `sasi-cgc` está num estado completo e
  funcional** antes de mexer no `sasi-checklist` (Task 10 em diante) — é o
  ponto de não-retorno mais seguro: se algo der errado dali pra frente, o
  `sasi-checklist` original ainda está intacto.

---

## Task 10: Remover código do CGC do `sasi-checklist`

**Files (em `sasi-checklist/`, este repo):**
- Delete: `src/lib/cgc/` (pasta inteira), `src/lib/sasi-api/` (pasta
  inteira), `src/lib/api-auth.ts`, `src/app/atividades-cgc/` (pasta
  inteira), `src/app/api/cgc/` (pasta inteira)
- Modify: `src/lib/db.ts:137-271` (remove as sete tabelas `cgc_*`)

- [ ] **Passo 1: Remover os arquivos/pastas**

```bash
git rm -r src/lib/cgc src/lib/sasi-api src/lib/api-auth.ts
git rm -r src/app/atividades-cgc src/app/api/cgc
```

- [ ] **Passo 2: Remover as tabelas `cgc_*` de `src/lib/db.ts`**

Apagar todo o bloco entre o comentário `// Grupos das Atividades do CGC.`
(linha 137) e o fim da função `runMigrations` (linha 271, antes do `}` de
fechamento) — as sete tabelas e seus índices. O que sobra é só a parte de
`checklists`/`activities`/`history`/`observations`/`completed_checklists`/
`completed_checklist_items`, sem nenhuma referência a `cgc_`.

- [ ] **Passo 3: Rodar o lint/build pra achar import quebrado**

```bash
npm run lint
npm run build
```

Esperado: erro nenhum. Se `npm run build` reclamar de import de
`@/lib/cgc/*`, `@/lib/sasi-api/*` ou `@/lib/api-auth` em algum arquivo que
ainda não foi tocado, é sinal de que a Task 11 (proxy) ainda não rodou —
seguir pra ela antes de considerar essa task concluída.

- [ ] **Passo 4: Commit**

```bash
git add -A
git commit -m "refactor: remove codigo das atividades do CGC (movido pro repo sasi-cgc)"
```

---

## Task 11: `/api/controle/cgc*` viram proxy para `CGC_APP_URL`

**Files (em `sasi-checklist/`):**
- Modify: `src/app/api/controle/cgc/route.ts` (reescreve inteiro)
- Modify: `src/app/api/controle/cgc/activities/route.ts` (reescreve inteiro)

**Interfaces:**
- Consome: `CGC_APP_URL` (env var nova, server-only) — URL base do
  `sasi-cgc` (ex.: `http://localhost:3001` local).
- Produz: mesmo contrato JSON de antes — `src/app/controle/page.tsx`
  (front-end) não muda nenhuma linha.

- [ ] **Passo 1: Reescrever `src/app/api/controle/cgc/route.ts`**

```typescript
/**
 * Resumo de atividades concluídas do CGC por grupo, para a página /controle.
 *
 * Proxy pro sasi-cgc: desde a separação em dois sistemas, os dados do CGC
 * não vivem mais neste banco. CGC_APP_URL é server-only, nunca exposta ao
 * navegador — o front-end de /controle continua chamando esta rota local,
 * sem saber que ela virou um repasse.
 */

import { NextResponse } from "next/server";

export async function GET() {
  const cgcAppUrl = process.env.CGC_APP_URL;
  if (!cgcAppUrl) {
    return NextResponse.json(
      { error: "CGC_APP_URL não configurada no servidor." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${cgcAppUrl}/api/controle/cgc`, {
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Falha ao consultar o sistema do CGC." },
      { status: 502 }
    );
  }
}
```

- [ ] **Passo 2: Reescrever `src/app/api/controle/cgc/activities/route.ts`**

```typescript
/**
 * Atividades concluídas de um grupo do CGC, para exportar XLSX em /controle.
 *
 * Proxy pro sasi-cgc — ver src/app/api/controle/cgc/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cgcAppUrl = process.env.CGC_APP_URL;
  if (!cgcAppUrl) {
    return NextResponse.json(
      { error: "CGC_APP_URL não configurada no servidor." },
      { status: 500 }
    );
  }

  const groupId = req.nextUrl.searchParams.get("group")?.trim();
  if (!groupId) {
    return NextResponse.json({ error: "Selecione um grupo." }, { status: 400 });
  }

  try {
    const url = new URL("/api/controle/cgc/activities", cgcAppUrl);
    url.searchParams.set("group", groupId);
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Falha ao consultar o sistema do CGC." },
      { status: 502 }
    );
  }
}
```

- [ ] **Passo 3: Commit**

```bash
git add src/app/api/controle/cgc/route.ts src/app/api/controle/cgc/activities/route.ts
git commit -m "refactor: /api/controle/cgc vira proxy pro sasi-cgc via CGC_APP_URL"
```

---

## Task 12: Env vars e Docker do `sasi-checklist` pós-separação

**Files (em `sasi-checklist/`):**
- Modify: `.env.example` (adiciona `CGC_APP_URL`, remove
  `SASI_API_TOKEN`/campos `SASI_CGC_*`, que não fazem mais sentido aqui)
- Modify: `.env.local` (mesmo ajuste, arquivo local não versionado)

- [ ] **Passo 1: Editar `.env.example`**

Remover o bloco `# --- Atividades do CGC (API SASI / Bone) ---` inteiro
(linhas 9-29 do arquivo atual — `SASI_API_TOKEN` e os `SASI_CGC_*`
opcionais não são mais usados neste repo) e adicionar no lugar:

```bash
# URL do sistema sasi-cgc (server-only — nunca exposta ao navegador).
# Usada pelo proxy de /api/controle/cgc* pra buscar dados do CGC.
CGC_APP_URL=http://localhost:3001
```

- [ ] **Passo 2: Aplicar o mesmo ajuste em `.env.local`**, preenchendo
  `CGC_APP_URL` com a URL real onde o `sasi-cgc` estiver rodando (local:
  `http://localhost:3001`, do jeito que ficou configurado na Task 7).

- [ ] **Passo 3: Confirmar `docker-compose.yml` do `sasi-checklist`** — já
  está em `3000:3000` desde a sessão anterior, nenhuma mudança necessária
  aqui. Só checar que não tem conflito de porta com o `sasi-cgc` (`3001`).

- [ ] **Passo 4: Commit**

```bash
git add .env.example
git commit -m "chore: adiciona CGC_APP_URL, remove env vars do CGC do sasi-checklist"
```

---

## Task 13: Validar `sasi-checklist` sozinho pós-separação

**Files:** nenhum novo — validação do que as Tasks 10-12 produziram.

- [ ] **Passo 1: Build e lint**

```bash
npm run lint
npm run build
```

Esperado: sem erro. Confirma que nenhuma página/rota do Checklist (que
não usa nada do CGC, exceto o proxy da Task 11) ficou quebrada pela
remoção.

- [ ] **Passo 2: Subir via Docker Desktop e testar as rotas do Checklist**

```bash
docker compose --profile dev up -d --build
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/?sasi-token=SEU_TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/checklists?sasi-token=SEU_TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/history?sasi-token=SEU_TOKEN"
```

Esperado: `200` nas três.

- [ ] **Passo 3: Testar `/controle` com o `sasi-cgc` ainda desligado**
  (comportamento de erro esperado, não é bug)

```bash
curl -s "http://localhost:3000/api/controle/cgc"
```

Esperado: JSON `{"error": "Falha ao consultar o sistema do CGC."}` com
status 502 — confirma que o proxy da Task 11 trata a ausência do
`sasi-cgc` sem quebrar a rota.

- [ ] **Passo 4: Parar o container**

```bash
docker compose --profile dev down
```

---

## Task 14: Validar os dois sistemas rodando juntos

**Files:** nenhum novo — validação end-to-end.

- [ ] **Passo 1: Subir os dois ao mesmo tempo**

```bash
cd ../sasi-cgc && docker compose --profile dev up -d --build
cd ../sasi-checklist && docker compose --profile dev up -d --build
sleep 5
```

- [ ] **Passo 2: Confirmar as duas portas respondem**

```bash
curl -s -o /dev/null -w "checklist: %{http_code}\n" "http://localhost:3000/?sasi-token=SEU_TOKEN"
curl -s -o /dev/null -w "cgc: %{http_code}\n" "http://localhost:3001/atividades-cgc?sasi-token=SEU_TOKEN"
```

Esperado: `200` nas duas.

- [ ] **Passo 3: Testar `/controle` puxando dado real do CGC via proxy**

```bash
curl -s "http://localhost:3000/api/controle/cgc"
```

Esperado: `{"groups": [...]}` com os grupos e contagem `concluded` — mesmo
formato de antes da separação, agora vindo do `sasi-cgc` via HTTP em vez
do banco local.

- [ ] **Passo 4: Teste manual no navegador**

Abrir `http://localhost:3000/controle` e clicar em "Exportar XLSX" pra um
grupo do CGC com atividades concluídas — confirma o fluxo end-to-end
completo (front-end → proxy → `sasi-cgc` → API SASI/banco novo →
planilha).

- [ ] **Passo 5: Deixar os dois rodando ou parar, a critério de quem estiver
  validando** — esta task não tem commit associado, é só verificação.

---

## Task 15: Migração de dados real e limpeza do banco antigo (GATED)

**Não executar esta task automaticamente.** Só roda depois que Tasks 1-14
estiverem completas e o usuário confirmar explicitamente que quer migrar os
dados de produção e apagar as tabelas antigas — é uma operação destrutiva
sobre dado real (comentários, histórico e status de atividades do CGC).

**Files:** nenhum arquivo de código — operação de dados/infra.

- [ ] **Passo 1: Rodar a migração real** (sem `--dry-run` — grava no banco
  novo)

```bash
cd sasi-checklist
SOURCE_TURSO_DATABASE_URL="<url banco atual>" \
SOURCE_TURSO_AUTH_TOKEN="<token banco atual>" \
DEST_TURSO_DATABASE_URL="<url sasi-cgc>" \
DEST_TURSO_AUTH_TOKEN="<token sasi-cgc>" \
node scripts/migrate-cgc-data.mjs
```

Esperado: `Todas as contagens batem entre origem e destino.` no final. Se
não bater, **parar aqui** e investigar antes de seguir pro próximo passo —
não apagar nada do banco antigo com migração incompleta.

- [ ] **Passo 2: Validar no `sasi-cgc` rodando que os dados migrados
  aparecem** (histórico, status de atividades, comentários — não só
  contagem de linhas)

Abrir `http://localhost:3001/atividades-cgc/historico?sasi-token=SEU_TOKEN`
e conferir que o histórico bate com o que aparecia antes da separação em
`http://localhost:3000/atividades-cgc/historico`.

- [ ] **Passo 3: Só com confirmação explícita do usuário — dropar as
  tabelas `cgc_*` do banco antigo**

```bash
node -e "
import('@libsql/client').then(async ({ createClient }) => {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const tables = [
    'cgc_groups', 'cgc_activity_status', 'cgc_history',
    'cgc_observations', 'cgc_group_totals',
    'cgc_message_cache', 'cgc_message_cache_sync',
  ];
  for (const t of tables) {
    await db.execute('DROP TABLE IF EXISTS ' + t);
    console.log('dropped', t);
  }
});
"
```

- [ ] **Passo 4: Commit final** (só o `scripts/migrate-cgc-data.mjs` já
  commitado na Task 2 — esta task não produz diff de código, é só a
  execução em si)

---

## Self-Review

**Cobertura do spec:** todas as seções do spec (`A` repositórios, `B`
banco de dados, `C` código duplicado, `D` proxy `/controle`, `E` Docker/env
vars, `F` ordem de execução) têm task correspondente — A/E: Tasks 3, 7, 12;
B: Tasks 1, 2, 15; C: Task 4; D: Task 11; F: ordem das Tasks 1→15 segue
exatamente a sequência do spec.

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task copia
arquivo real já lido nesta sessão ou escreve código completo.

**Consistência de tipos/nomes:** `CGC_APP_URL` usado com o mesmo nome nas
Tasks 11, 12 e 14. `getDb`/`initDb` com a mesma assinatura em Task 5
(produz) e Task 6 (consome). Correção aplicada durante o brainstorming:
lista de tabelas `cgc_*` corrigida de 5 para 7 em todas as tasks que a
referenciam (Global Constraints, Task 2, Task 5, Task 15) — a spec original
tinha a lista de 5 vinda do CLAUDE.md desatualizado.
