# Checklist de Simulados

Aplicação web para criar, acompanhar e registrar checklists de simulados.

## Configuração

Crie um arquivo `.env.local` com as variáveis abaixo:

```env
TURSO_DATABASE_URL=libsql://seu-banco.turso.io
TURSO_AUTH_TOKEN=seu-token-do-banco
AUTH_USER_ENDPOINT=https://seu-provedor-de-autenticacao.example/me
```

`AUTH_USER_ENDPOINT` deve aceitar o cabeçalho `Authorization: Bearer <token>` e retornar um usuário com `id` e `name`.

## Execução

```bash
npm install
npm run dev
```

Acesse localmente em `http://localhost:3000`. Em produção, envie o token como parâmetro `?sasi-token=SEU_TOKEN`.

## Verificação

```bash
npm run lint
npm run build
```
