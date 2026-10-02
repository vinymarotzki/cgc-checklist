// scripts/test/smoke.mjs
//
// Teste de fumaça contra o container de teste (`npm run test:docker`).
// Roda no host, com o fetch nativo do Node, e percorre o fluxo principal do
// checklist de ponta a ponta: autenticação, criar checklist, mudar status,
// observação, histórico, renomear e excluir. Usa os tokens fixos do
// scripts/test/mock-services.mjs e o banco descartável do container — nunca
// aponte TEST_BASE_URL para produção, o teste cria e apaga dados.
//
// Uso: node scripts/test/smoke.mjs   (TEST_BASE_URL padrão: http://localhost:3100)

const BASE = (process.env.TEST_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
const TOKEN_A = "token-usuario-a";

let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers["x-sasi-token"] = token;
  if (body !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* páginas HTML não são JSON */ }
  return { status: res.status, json, text };
}

// O container sobe antes do Next terminar de iniciar; espera até 60s.
async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/checklists`);
      if (res.ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function main() {
  console.log(`Smoke test em ${BASE}`);
  if (!(await waitForApp())) {
    console.log("  FAIL app não respondeu em 60s — o container está de pé? (npm run test:docker)");
    process.exit(1);
  }

  console.log("\nPáginas");
  for (const page of ["/", "/checklists", "/admin", "/history", "/controle"]) {
    const res = await call("GET", page);
    check(`GET ${page} responde 200`, res.status === 200, `status ${res.status}`);
  }

  console.log("\nAutenticação");
  check("sem token -> 401", (await call("GET", "/api/checklists")).status === 401);
  check("token desconhecido -> 401", (await call("GET", "/api/checklists", { token: "token-falso" })).status === 401);
  const me = await call("GET", "/api/checklists", { token: TOKEN_A });
  check("token do usuário A -> 200", me.status === 200, `status ${me.status}`);
  check("API devolve o usuário A", me.json?.user?.id === "user-a", JSON.stringify(me.json?.user));

  console.log("\nChecklist");
  const created = await call("POST", "/api/checklists", {
    token: TOKEN_A,
    body: {
      title: "Smoke test",
      activities: [
        { category: "Categoria 1", activity: "Atividade 1" },
        { category: "Categoria 1", activity: "Atividade 2" },
      ],
    },
  });
  const checklistId = created.json?.checklist?.id;
  check("cria checklist com 2 atividades", created.status === 200 && Boolean(checklistId), created.text);
  if (!checklistId) return;

  const listed = await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A });
  const activities = listed.json?.activities || [];
  check("lista as 2 atividades do checklist", activities.length === 2, `veio ${activities.length}`);
  const activityId = activities[0]?.id;

  const patched = await call("PATCH", `/api/activities?checklist=${checklistId}`, {
    token: TOKEN_A,
    body: { id: activityId, status: "EM_ANDAMENTO" },
  });
  check("muda status para EM_ANDAMENTO", patched.status === 200, patched.text);

  const observation = await call("POST", "/api/observations", {
    token: TOKEN_A,
    body: { activity_id: activityId, text: "Observação do smoke test" },
  });
  const observationId = observation.json?.observation?.id;
  check("cria observação", observation.status === 200 && Boolean(observationId), observation.text);

  const history = await call("GET", "/api/history", { token: TOKEN_A });
  const entries = (history.json?.history || []).filter((h) => h.activity_id === activityId);
  check("histórico registra status e observação", entries.length >= 2, `veio ${entries.length}`);

  const renamed = await call("PATCH", "/api/checklists", {
    token: TOKEN_A,
    body: { id: checklistId, title: "Smoke test renomeado" },
  });
  check("renomeia checklist", renamed.status === 200, renamed.text);

  const deleted = await call("DELETE", "/api/checklists", { token: TOKEN_A, body: { id: checklistId } });
  check("exclui checklist", deleted.status === 200, deleted.text);
  const afterDelete = await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A });
  check("atividades saem junto com o checklist", (afterDelete.json?.activities || []).length === 0);

  await hardeningChecks();
  await inputChecks();
}

// GET /api/observations?checklist= devolve só as observações daquele checklist.
async function scopeChecks() {
  console.log("\nObservações por checklist");
  const ids = [];
  for (const title of ["Escopo 1", "Escopo 2"]) {
    const created = await call("POST", "/api/checklists", {
      token: TOKEN_A,
      body: { title, activities: [{ category: "Cat", activity: `Ativ ${title}` }] },
    });
    const checklistId = created.json?.checklist?.id;
    const activityId = (await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A })).json?.activities?.[0]?.id;
    await call("POST", "/api/observations", { token: TOKEN_A, body: { activity_id: activityId, text: `Nota ${title}` } });
    ids.push({ checklistId, activityId });
  }
  check("criou 2 checklists com 1 observação cada", ids.every((i) => i.checklistId && i.activityId));

  const first = (await call("GET", `/api/observations?checklist=${ids[0].checklistId}`, { token: TOKEN_A })).json?.observations || [];
  check("com ?checklist= vem só a observação do checklist", first.length === 1 && first[0].activity_id === ids[0].activityId, `veio ${first.length}`);
  const all = (await call("GET", "/api/observations", { token: TOKEN_A })).json?.observations || [];
  check("sem ?checklist= segue devolvendo as de todos", all.some((o) => o.activity_id === ids[0].activityId) && all.some((o) => o.activity_id === ids[1].activityId));
  const none = (await call("GET", "/api/observations?checklist=nao-existe", { token: TOKEN_A })).json?.observations || [];
  check("checklist inexistente -> lista vazia", none.length === 0);

  for (const { checklistId } of ids) {
    await call("DELETE", "/api/checklists", { token: TOKEN_A, body: { id: checklistId } });
  }
}

// Regras da PR de endurecimento: /controle com login, autoria, escopo por
// checklist e remoção em cascata. Dois usuários, porque autoria só se testa
// com alguém tentando mexer no que é de outro.
async function hardeningChecks() {
  const TOKEN_B = "token-usuario-b";

  console.log("\n/controle exige login");
  for (const path of ["/api/controle/checklists", "/api/controle/cgc", "/api/controle/cgc/activities?group=grupo-cgc"]) {
    check(`sem token em ${path.split("?")[0]} -> 401`, (await call("GET", path)).status === 401);
  }
  const groups = await call("GET", "/api/controle/cgc", { token: TOKEN_A });
  check("com token, o proxy devolve os grupos do mock", groups.status === 200 && groups.json?.groups?.length === 2, groups.text);
  const cgcActivities = await call("GET", "/api/controle/cgc/activities?group=grupo-cgc", { token: TOKEN_A });
  check("com token, o proxy devolve as atividades do grupo", cgcActivities.json?.activities?.length === 2, cgcActivities.text);
  check("com token, /api/controle/checklists -> 200", (await call("GET", "/api/controle/checklists", { token: TOKEN_A })).status === 200);

  console.log("\nAutoria do checklist");
  const created = await call("POST", "/api/checklists", {
    token: TOKEN_A,
    body: { title: "Do usuário A", activities: [{ category: "Cat", activity: "Ativ" }] },
  });
  const checklistId = created.json?.checklist?.id;
  check("A cria um checklist", Boolean(checklistId), created.text);
  if (!checklistId) return;

  check("B não renomeia o checklist de A -> 403",
    (await call("PATCH", "/api/checklists", { token: TOKEN_B, body: { id: checklistId, title: "Invadido" } })).status === 403);
  check("B não exclui o checklist de A -> 403",
    (await call("DELETE", "/api/checklists", { token: TOKEN_B, body: { id: checklistId } })).status === 403);
  check("checklist inexistente -> 404",
    (await call("DELETE", "/api/checklists", { token: TOKEN_A, body: { id: "nao-existe" } })).status === 404);
  const stillThere = await call("GET", "/api/checklists", { token: TOKEN_A });
  const survivor = (stillThere.json?.checklists || []).find((c) => c.id === checklistId);
  check("o checklist de A continua intacto", survivor?.title === "Do usuário A", survivor?.title);

  console.log("\nAutoria da observação");
  const activityId = (await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A })).json?.activities?.[0]?.id;
  const obs = await call("POST", "/api/observations", { token: TOKEN_A, body: { activity_id: activityId, text: "Nota de A" } });
  const obsId = obs.json?.observation?.id;
  check("A cria uma observação", Boolean(obsId), obs.text);
  check("B não edita a observação de A -> 403",
    (await call("PATCH", "/api/observations", { token: TOKEN_B, body: { id: obsId, text: "Invadida" } })).status === 403);
  check("B não apaga a observação de A -> 403",
    (await call("DELETE", "/api/observations", { token: TOKEN_B, body: { id: obsId } })).status === 403);
  check("B pode criar a própria observação",
    (await call("POST", "/api/observations", { token: TOKEN_B, body: { activity_id: activityId, text: "Nota de B" } })).status === 200);
  check("A edita a própria observação",
    (await call("PATCH", "/api/observations", { token: TOKEN_A, body: { id: obsId, text: "Nota de A editada" } })).status === 200);

  console.log("\nEscopo por checklist");
  check("apagar categoria sem ?checklist= -> 400",
    (await call("DELETE", "/api/activities", { token: TOKEN_A, body: { category: "Cat" } })).status === 400);
  check("renomear categoria sem ?checklist= -> 400",
    (await call("PUT", "/api/activities", { token: TOKEN_A, body: { oldCategory: "Cat", category: "Outra" } })).status === 400);
  const intact = await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A });
  check("as atividades continuam lá depois das recusas", intact.json?.activities?.length === 1);

  console.log("\nRemoção em cascata");
  const obsBefore = (await call("GET", "/api/observations", { token: TOKEN_A })).json?.observations || [];
  check("existem observações da atividade antes de apagar", obsBefore.some((o) => o.activity_id === activityId));
  check("apagar a atividade pelo id -> 200",
    (await call("DELETE", "/api/activities", { token: TOKEN_A, body: { id: activityId } })).status === 200);
  const obsAfter = (await call("GET", "/api/observations", { token: TOKEN_A })).json?.observations || [];
  check("as observações da atividade saíram junto", !obsAfter.some((o) => o.activity_id === activityId));
  const histAfter = (await call("GET", "/api/history", { token: TOKEN_A })).json?.history || [];
  check("o histórico da atividade saiu junto", !histAfter.some((h) => h.activity_id === activityId));

  check("A exclui o próprio checklist (limpeza)",
    (await call("DELETE", "/api/checklists", { token: TOKEN_A, body: { id: checklistId } })).status === 200);

  await scopeChecks();
}

main()
  .catch((error) => {
    failures += 1;
    console.log(`  FAIL erro inesperado: ${error?.message || error}`);
  })
  .finally(() => {
    console.log(`\n${passes} ok, ${failures} falha(s)`);
    process.exit(failures > 0 ? 1 : 0);
  });

// Validação de entrada: corpo que não é JSON e status fora do vocabulário.
async function inputChecks() {
  console.log("\nValidação de entrada");
  const created = await call("POST", "/api/checklists", {
    token: TOKEN_A,
    body: { title: "Validação", activities: [{ category: "Cat", activity: "Ativ" }] },
  });
  const checklistId = created.json?.checklist?.id;
  check("cria o checklist da validação", Boolean(checklistId), created.text);
  if (!checklistId) return;
  const activityId = (await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A })).json?.activities?.[0]?.id;

  for (const [method, path] of [
    ["POST", "/api/checklists"], ["PATCH", "/api/checklists"], ["DELETE", "/api/checklists"],
    ["PATCH", "/api/activities"], ["POST", "/api/observations"],
  ]) {
    const res = await call(method, path, { token: TOKEN_A, raw: "isto não é json" });
    check(`${method} ${path} com corpo inválido -> 400 (não 500)`, res.status === 400, `status ${res.status}`);
  }

  const bad = await call("PATCH", "/api/activities", { token: TOKEN_A, body: { id: activityId, status: "QUALQUER_COISA" } });
  check("status desconhecido -> 400", bad.status === 400, `status ${bad.status}`);
  const stillOk = (await call("GET", `/api/activities?checklist=${checklistId}`, { token: TOKEN_A })).json?.activities?.[0];
  check("o status inválido não foi gravado", stillOk?.status === "SEM_STATUS", stillOk?.status);
  for (const status of ["NAO_INICIADO", "EM_ANDAMENTO", "CONCLUIDO"]) {
    const ok = await call("PATCH", "/api/activities", { token: TOKEN_A, body: { id: activityId, status } });
    check(`status ${status} continua aceito`, ok.status === 200, `status ${ok.status}`);
  }

  check("limpeza do checklist da validação",
    (await call("DELETE", "/api/checklists", { token: TOKEN_A, body: { id: checklistId } })).status === 200);
}
