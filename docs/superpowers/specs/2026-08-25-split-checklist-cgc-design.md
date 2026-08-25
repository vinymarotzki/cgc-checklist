# Separação Checklist de Simulados / Atividades do CGC em dois sistemas

Data: 2026-08-25
Status: aprovado (aguardando plano de implementação)

## Motivação

Hoje "Checklist de Simulados" e "Atividades do CGC" são dois produtos
independentes vivendo no mesmo app Next.js (mesmo repositório, mesmo
container, mesmo banco Turso), compartilhando só o vocabulário de status e o
padrão de autenticação — ver seção "Architecture" do CLAUDE.md do repo atual.

Motivo da separação: **deploy independente** — poder atualizar/reiniciar um
sistema sem afetar o outro (ex.: mexer no CGC sem derrubar o Checklist).

## Decisões

1. **Dois repositórios git separados**, não monorepo.
   - `sasi-checklist` (repo atual, hoje neste diretório) — fica só com o
     Checklist de Simulados + o painel `/controle`.
   - `sasi-cgc` (repo novo) — Atividades do CGC.
2. **Dois bancos Turso separados.** O banco atual fica só com as tabelas do
   Checklist; banco Turso novo criado só para as tabelas `cgc_*`.
3. **Código compartilhado é duplicado**, não extraído para pacote comum
   (auth, vocabulário de status, CSS responsivo) — ver seção "Código
   duplicado" abaixo. Motivo: dois repos, sem monorepo, e a área
   compartilhada hoje já é pequena.
4. **Cada sistema em URL/porta própria**, sem reverse proxy unificando
   domínio. Local: checklist em `:3000`, CGC em `:3001`.
5. **`/controle`** (painel que cruza dados dos dois produtos num XLSX,
   hoje não documentado no CLAUDE.md) fica no repo `sasi-checklist` e passa
   a buscar os dados do CGC via chamada HTTP server-side pro `sasi-cgc`
   (proxy), em vez de ler o banco do CGC diretamente.

## Divisão de rotas e responsabilidades

### `sasi-checklist` (fica com)

- Páginas: `/`, `/checklists`, `/admin`, `/history`, `/controle`.
- API: `/api/checklists`, `/api/activities`, `/api/observations`,
  `/api/history`, `/api/controle/checklists`, `/api/controle/cgc`,
  `/api/controle/cgc/activities` (as duas últimas viram proxy — ver
  "`/controle` cross-app").
- Tabelas: `checklists`, `activities`, `history`, `observations`,
  `completed_checklists`, `completed_checklist_items`.
- Banco Turso: o atual (mesma `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` de
  hoje), depois de dropadas as tabelas `cgc_*`.

### `sasi-cgc` (repo novo, recebe)

- Páginas: `/atividades-cgc`, `/atividades-cgc/historico`.
- API: `/api/cgc/groups`, `/api/cgc/activities`, `/api/cgc/observations`,
  `/api/cgc/history`, `/api/cgc/cron-sync`, `/api/cgc/webhook`, e as rotas
  movidas `/api/controle/cgc`, `/api/controle/cgc/activities` (mesmo
  contrato de resposta, continuam públicas, sem sasi-token).
- Código: `src/lib/cgc/**`, `src/lib/sasi-api/**`.
- Tabelas: `cgc_groups`, `cgc_activity_status`, `cgc_history`,
  `cgc_observations`, `cgc_group_totals`.
- Banco Turso: novo, criado especificamente para este repo.

## Código duplicado (não compartilhado via pacote)

Cada repo mantém sua própria cópia, editável independentemente a partir da
separação (uma mudança num não se propaga mais pro outro):

- `src/lib/token.ts`, `src/hooks/useSasiToken.ts`, `src/lib/auth.ts`
  (`authenticateToken`) — ambos continuam validando contra o mesmo
  `AUTH_USER_ENDPOINT` externo; só o código de validação é duplicado, não o
  serviço de auth em si.
- `src/lib/checklist-status.ts` (vocabulário `SEM_STATUS`, `NAO_INICIADO`,
  `EM_ANDAMENTO`, `CONCLUIDO`, `IMPEDIDO`). `sasi-cgc` também leva
  `src/lib/cgc/colors.ts`.
- `src/app/globals.css` (classes responsivas: `.app-header-inner`,
  `.app-nav`, `.split-card`, etc.) — duplicado, cada repo mantém a sua.
- Header/nav de cada app perde o link cruzado direto pro outro produto (ou
  vira link absoluto pra URL do outro sistema, a critério de quem for
  implementar).

## `/controle` cross-app

Front-end (`src/app/controle/page.tsx`) não muda — continua fazendo fetch
relativo em `/api/controle/checklists`, `/api/controle/cgc` e
`/api/controle/cgc/activities`, todos dentro do próprio `sasi-checklist`.

O que muda é a implementação das duas rotas do CGC dentro do
`sasi-checklist`:

- Hoje: leem `cgc_activity_status`/`cgc_observations` direto do banco e
  escaneiam a API SASI.
- Depois: viram proxies finos — recebem a chamada do front-end, fazem
  `fetch` server-side pra `${CGC_APP_URL}/api/controle/cgc` (ou
  `/activities`) no repo `sasi-cgc`, repassam o JSON de volta como está.

Nova env var, só no `sasi-checklist`, server-only (nunca exposta ao
navegador): `CGC_APP_URL` — ex. `http://localhost:3001` local, URL de
produção do `sasi-cgc` depois do deploy.

Sem necessidade de autenticação extra entre os dois apps: as rotas
`/api/controle/cgc*` já são públicas por design ("rota pública de
propósito", ver comentário original no código) — continuam assim no
`sasi-cgc`, só acessadas server-to-server em vez de client-to-server.

## Docker

Cada repo leva sua própria cópia do setup já validado neste repo:
`Dockerfile` multi-stage (`deps` → `dev`/`builder` → `runner`),
`docker-compose.yml` com profiles `dev`/`prod`, `.dockerignore`,
`next.config.js` com `output: "standalone"` e `webpack.watchOptions.poll`
condicionado a `WATCHPACK_POLLING=true` (necessário pro hot-reload
funcionar com bind mount Windows → WSL2 no Docker Desktop).

Porta padrão nos compose: `sasi-checklist` em `3000`, `sasi-cgc` em `3001`
(evita conflito rodando os dois ao mesmo tempo localmente).

### Env vars por repo

`sasi-checklist`:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (banco atual)
- `AUTH_USER_ENDPOINT`
- `CGC_APP_URL` (novo)

`sasi-cgc`:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (banco novo)
- `AUTH_USER_ENDPOINT`
- `SASI_API_TOKEN`

## Migração de dados

Banco Turso atual tem os dados `cgc_*` de produção — precisam ser copiados
pro banco novo, não recriados do zero.

1. Criar banco Turso novo para o `sasi-cgc`.
2. Script de migração (roda uma vez): lê `cgc_groups`,
   `cgc_activity_status`, `cgc_history`, `cgc_observations`,
   `cgc_group_totals` do banco atual e grava no banco novo, preservando
   IDs e timestamps.
3. Validar contagens (linha a linha ou por `COUNT(*)` por tabela) batendo
   entre origem e destino antes de considerar a migração concluída.
4. Só depois dos dois sistemas rodando de forma independente e validados
   (seção "Ordem de execução"), dropar as tabelas `cgc_*` do banco antigo.

## Ordem de execução

1. Criar banco Turso novo pro CGC.
2. Rodar script de migração (banco antigo → banco novo), sem apagar nada
   do banco antigo ainda.
3. Criar repo `sasi-cgc`: copiar código do CGC (páginas, API, `src/lib/cgc/`,
   `src/lib/sasi-api/`, cópias da seção "Código duplicado") + as rotas
   `/api/controle/cgc*` movidas. Apontar pro banco novo. Rodar e validar
   funcionando sozinho (Docker Desktop, profile `dev`).
4. No `sasi-checklist`: remover tudo que é do CGC do código e do
   `initDb()`; transformar `/api/controle/cgc*` em proxy pro `sasi-cgc`.
5. Validar os dois rodando juntos localmente (portas 3000/3001), testando
   em especial `/controle` puxando dado dos dois sistemas.
6. Só depois de validado: apagar as tabelas `cgc_*` do banco antigo.

## Fora de escopo (não decidido aqui)

- Deploy de produção dos dois sistemas (dois projetos Vercel, domínios,
  etc.) — este spec cobre a separação em si; deploy fica pra quando os
  dois estiverem rodando localmente e validados.
- Criação dos repositórios GitHub novos em si (`gh repo create`) — ação
  que precisa de confirmação explícita antes de ser executada.
