// scripts/test/mock-services.mjs
//
// Serviços falsos para o container de teste (perfil `test` do
// docker-compose). Substituem as duas dependências externas do app, para que
// o teste não precise de credencial real nem toque em dado de produção:
//
// - AUTH_USER_ENDPOINT (GET /me): aceita só os dois tokens fixos abaixo.
//   Dois usuários, e não um, porque as regras de autoria (lib/ownership.ts)
//   só podem ser testadas com alguém tentando alterar o que é de outro.
// - cgc-atividades (GET /api/controle/cgc*): devolve dados de exemplo, e só
//   quando o header x-controle-secret bate com CONTROLE_PROXY_SECRET — o
//   mesmo contrato do serviço real.
//
// Sem dependências: usa só o `http` do Node.

import http from "node:http";

const PORT = Number(process.env.PORT || 4000);
const PROXY_SECRET = process.env.CONTROLE_PROXY_SECRET || "";

const TEST_USERS = {
  "token-usuario-a": { id: "user-a", name: "Usuário A" },
  "token-usuario-b": { id: "user-b", name: "Usuário B" },
};

const CGC_GROUPS = [
  { id: "grupo-cgc", name: "CGC", concluded: 2 },
  { id: "grupo-nuppae", name: "NUPPAE", concluded: 0 },
];

const CGC_ACTIVITIES = {
  "grupo-cgc": [
    {
      id: "msg-1",
      description: "Atividade de teste 1",
      deadline: "2026-10-10",
      comments: "",
      responsible: "Usuário A",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      id: "msg-2",
      description: "Atividade de teste 2",
      deadline: null,
      comments: "Comentário de teste",
      responsible: "Usuário B",
      updatedAt: "2026-10-01T13:00:00.000Z",
    },
  ],
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/me") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = TEST_USERS[token];
    return user ? sendJson(res, 200, user) : sendJson(res, 401, { error: "token inválido" });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/controle/cgc")) {
    if (!PROXY_SECRET || req.headers["x-controle-secret"] !== PROXY_SECRET) {
      return sendJson(res, 401, { error: "x-controle-secret inválido" });
    }
    if (url.pathname === "/api/controle/cgc") {
      return sendJson(res, 200, { groups: CGC_GROUPS });
    }
    if (url.pathname === "/api/controle/cgc/activities") {
      const group = url.searchParams.get("group") || "";
      return sendJson(res, 200, { activities: CGC_ACTIVITIES[group] || [] });
    }
  }

  return sendJson(res, 404, { error: "rota não existe no mock" });
});

server.listen(PORT, () => {
  console.log(`[mock-services] ouvindo na porta ${PORT}`);
});
