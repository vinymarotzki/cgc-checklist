# SASI – Checklist de Simulados

Sistema web para acompanhamento de simulados escolares, integrado com autenticação via SASI.

## Stack

- **Next.js 15** + TypeScript
- **Tailwind CSS**
- **Turso** (SQLite em nuvem)
- **Vercel** (hospedagem)

---

## Setup Local

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar banco de dados (Turso)

Crie uma conta em https://turso.tech e um banco de dados:

```bash
# Instalar CLI do Turso
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# Criar banco
turso db create sasi-checklist

# Ver URL e token
turso db show sasi-checklist
turso db tokens create sasi-checklist
```

### 3. Configurar variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```
TURSO_DATABASE_URL=libsql://sasi-checklist-seu-org.turso.io
TURSO_AUTH_TOKEN=seu_token_aqui
```

### 4. Popular o banco com as atividades

```bash
npm run db:seed
```

### 5. Rodar localmente

```bash
npm run dev
```

Acesse: `http://localhost:3000/?sasi-token=SEU_TOKEN_SASI`

---

## Deploy na Vercel

### 1. Push para GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/seu-usuario/sasi-checklist.git
git push -u origin main
```

### 2. Importar na Vercel

1. Acesse https://vercel.com/new
2. Importe o repositório do GitHub
3. Adicione as variáveis de ambiente:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
4. Deploy!

### 3. Popular o banco em produção

Após o deploy, rode localmente apontando para o banco de produção:

```bash
npm run db:seed
```

(O seed usa as mesmas variáveis do `.env.local`)

---

## Uso

### URL de acesso

```
https://seu-app.vercel.app/?sasi-token=TOKEN_DO_USUARIO_SASI
https://seu-app.vercel.app/history?sasi-token=TOKEN_DO_USUARIO_SASI
```

O token é validado em `https://api.sasi.io/api/v2/providers/external/me` a cada acesso.

### Status disponíveis

| Status | Significado |
|--------|-------------|
| SEM_STATUS | Não avaliado ainda |
| NAO_INICIADO | Identificado, aguardando início |
| EM_ANDAMENTO | Em execução |
| CONCLUIDO | Finalizado com sucesso |
| IMPEDIDO | Bloqueado por algum motivo |

---

## Estrutura do projeto

```
src/
├── app/
│   ├── page.tsx              # Checklist principal
│   ├── history/
│   │   └── page.tsx          # Histórico de alterações
│   └── api/
│       ├── activities/
│       │   └── route.ts      # GET + PATCH atividades
│       └── history/
│           └── route.ts      # GET histórico
├── lib/
│   ├── db.ts                 # Conexão Turso
│   ├── sasi.ts               # Auth SASI
│   └── seed.ts               # Popular banco
```
