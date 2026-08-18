"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sasiAuthHeaders } from "@/lib/token";
import { useSasiToken } from "@/hooks/useSasiToken";
import { getCgcGroupColor } from "@/lib/cgc/colors";
import {
  ArrowLeft, ChevronUp, ChevronDown, Pencil, X, MessageSquare,
  History, Search, Lock, RefreshCw, ExternalLink, User,
} from "lucide-react";
import {
  STATUS_OPTIONS,
  getStatusStyle,
} from "@/lib/checklist-status";
import type {
  CgcActivitiesResponse,
  CgcActivity,
  CgcGroup,
  CgcPriorityLevel,
} from "@/lib/cgc/types";

interface User {
  id: string;
  name: string;
}

interface Observation {
  id: string;
  message_id: string;
  text: string;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Grupo com o contador de concluídas que a API de grupos devolve. */
type GroupWithProgress = CgcGroup & { total?: number; concluded?: number };

const PAGE_SIZE = 50;

/**
 * Ordem fixa de exibição dos grupos semeados. Grupos criados depois (fora
 * dessa lista) aparecem ao final, na ordem em que a API os devolve.
 */
const GROUP_DISPLAY_ORDER = ["CGC", "NUPPAE", "NGOA", "CIPA"];

function sortGroupsByDisplayOrder<T extends { name: string }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    const indexA = GROUP_DISPLAY_ORDER.indexOf(a.name.trim().toUpperCase());
    const indexB = GROUP_DISPLAY_ORDER.indexOf(b.name.trim().toUpperCase());
    const rankA = indexA === -1 ? GROUP_DISPLAY_ORDER.length : indexA;
    const rankB = indexB === -1 ? GROUP_DISPLAY_ORDER.length : indexB;
    return rankA - rankB;
  });
}

/**
 * Intervalo de sincronização automática com a API SASI. Além dele, a lista é
 * recarregada assim que a aba volta ao foco — é o que faz uma mensagem recém
 * enviada aparecer sem esperar o próximo ciclo.
 */
const REFRESH_INTERVAL_MS = 15000;

function formatClock(date: Date | null) {
  if (!date) return null;
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getPriorityStyle(level: CgcPriorityLevel) {
  const map: Record<CgcPriorityLevel, { bg: string; color: string; border: string }> = {
    ALTA: { bg: "#2A1A1A", color: "#F87171", border: "#DC2626" },
    MEDIA: { bg: "#2A2410", color: "#FBBF24", border: "#B45309" },
    BAIXA: { bg: "#0F2A1E", color: "#34D399", border: "#059669" },
    OUTRA: { bg: "#1A2E4A", color: "#60A5FA", border: "#2563EB" },
    SEM_PRIORIDADE: { bg: "#1E2333", color: "#7A82A0", border: "#2A3045" },
  };
  return map[level] ?? map.SEM_PRIORIDADE;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isOverdue(iso: string | null) {
  if (!iso) return false;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

/** Ordem de exibição dentro de cada grupo: não iniciadas primeiro, concluídas por último. */
const STATUS_SORT_ORDER: Record<string, number> = {
  NAO_INICIADO: 0,
  SEM_STATUS: 0,
  IMPEDIDO: 0,
  EM_ANDAMENTO: 1,
  CONCLUIDO: 2,
};

function sortByStatus(activities: CgcActivity[]) {
  return [...activities].sort(
    (a, b) => (STATUS_SORT_ORDER[a.status] ?? 0) - (STATUS_SORT_ORDER[b.status] ?? 0)
  );
}

function groupByCategory(activities: CgcActivity[]) {
  const groups: Record<string, CgcActivity[]> = {};
  for (const activity of activities) {
    // Neste canal as mensagens chegam sem categoria; o nome do canal lê melhor
    // como cabeçalho de seção do que um "Sem categoria" repetido.
    const key = activity.category || activity.channel || "Sem categoria";
    if (!groups[key]) groups[key] = [];
    groups[key].push(activity);
  }
  return groups;
}

/** Retrato enviado junto com alterações, para o histórico não depender da API. */
function activitySnapshot(activity: CgcActivity | undefined, groupId: string) {
  if (!activity) return { group_id: groupId };
  return {
    group_id: groupId,
    group_name: activity.group,
    description: activity.description,
    priority: activity.priority.label,
    deadline: activity.deadline?.label ?? null,
  };
}

function getStats(activities: CgcActivity[]) {
  return {
    total: activities.length,
    done: activities.filter((a) => a.status === "CONCLUIDO").length,
    inProgress: activities.filter((a) => a.status === "EM_ANDAMENTO").length,
    blocked: activities.filter((a) => a.status === "IMPEDIDO").length,
  };
}

function AtividadesCgcPage() {
  const searchParams = useSearchParams();
  const token = useSasiToken();
  const groupId = searchParams.get("grupo") || "";

  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<GroupWithProgress[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [activities, setActivities] = useState<CgcActivity[]>([]);
  const [group, setGroup] = useState<CgcGroup | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [observations, setObservations] = useState<Observation[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [obsValue, setObsValue] = useState("");
  // Cards de atividade escondem os campos dinâmicos por padrão; abrir um não
  // deve remover a memória dos outros já abertos, daí o Set em vez de um id só.
  const [expandedFieldIds, setExpandedFieldIds] = useState<Set<string>>(new Set());

  function toggleFields(id: string) {
    setExpandedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hrefWithParams = useCallback((path: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extra || {})) params.set(key, value);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }, []);

  const fetchGroups = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      return;
    }
    try {
      const res = await fetch("/api/cgc/groups", { headers: sasiAuthHeaders(token) });
      if (res.status === 401) {
        setAuthError(true);
        return;
      }
      if (!res.ok) {
        setApiError("Não foi possível carregar os grupos.");
        return;
      }
      const data = await res.json();
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setUser(data.user ?? null);
    } catch {
      setApiError("Falha de conexão ao carregar os grupos.");
    }
  }, [token]);

  const fetchActivities = useCallback(
    async (options: { showIndicator?: boolean } = {}) => {
      if (!groupId) {
        setActivities([]);
        setGroup(null);
        setTotal(null);
        return;
      }

      if (options.showIndicator) setRefreshing(true);
      setApiError(null);

      try {
        const params = new URLSearchParams();
        params.set("group", groupId);
        params.set("page", String(page));
        params.set("limit", String(PAGE_SIZE));
        if (search) params.set("search", search);

        const res = await fetch(`/api/cgc/activities?${params.toString()}`, { headers: sasiAuthHeaders(token) });
        const data = await res.json().catch(() => null);

        if (res.status === 401) {
          // 401 do nosso auth vs. 401 vindo da API SASI são erros diferentes.
          if (data?.kind === "auth") {
            setApiError(data.error || "Token recusado pela API SASI.");
            setActivities([]);
          } else {
            setAuthError(true);
          }
          return;
        }

        if (!res.ok) {
          setApiError(data?.error || "Não foi possível carregar as atividades do CGC.");
          setActivities([]);
          return;
        }

        const payload = data as CgcActivitiesResponse;
        setActivities(Array.isArray(payload.activities) ? payload.activities : []);
        setGroup(payload.group ?? null);
        setTotal(typeof payload.total === "number" ? payload.total : null);
        setHasMore(Boolean(payload.hasMore));
        setSkipped(typeof payload.skipped === "number" ? payload.skipped : 0);
        setTruncated(Boolean(payload.truncated));
        setUnconfigured(Boolean(payload.unconfigured));
        setLastSync(new Date());
        if (payload.user) setUser(payload.user);
      } catch {
        setApiError("Falha de conexão ao consultar as atividades do CGC.");
        setActivities([]);
      } finally {
        setRefreshing(false);
      }
    },
    [groupId, page, search, token]
  );

  const fetchObservations = useCallback(async () => {
    if (!token || !groupId) return;
    try {
      const res = await fetch("/api/cgc/observations", { headers: sasiAuthHeaders(token) });
      if (!res.ok) return;
      const data = await res.json();
      setObservations(Array.isArray(data.observations) ? data.observations : []);
    } catch {
      // Comentário é acessório: falhar aqui não pode derrubar a listagem.
    }
  }, [groupId, token]);

  useEffect(() => {
    let active = true;
    (async () => {
      // Cada chamada paga sozinha o custo de autenticar contra o
      // AUTH_USER_ENDPOINT; encadeá-las (await sequencial) somava esse custo
      // 2-3 vezes antes da tela aparecer. `groups` só é usado na tela de
      // seleção, então dentro de um grupo nem precisa ser buscado.
      if (groupId) {
        await Promise.all([fetchActivities(), fetchObservations()]);
      } else {
        await fetchGroups();
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [groupId, fetchGroups, fetchActivities, fetchObservations]);

  // Sincronização automática. Sem indicador visual: recarregar a lista a cada
  // ciclo não pode piscar a tela nem atrapalhar quem está mexendo nela.
  useEffect(() => {
    if (!groupId) return;

    const sync = () => {
      if (document.visibilityState === "hidden") return;
      fetchActivities();
      fetchObservations();
    };

    const timer = setInterval(sync, REFRESH_INTERVAL_MS);
    // Voltar para a aba é o momento em que o usuário mais espera ver o novo.
    const syncOnReturn = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", syncOnReturn);
    document.addEventListener("visibilitychange", syncOnReturn);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", syncOnReturn);
      document.removeEventListener("visibilitychange", syncOnReturn);
    };
  }, [groupId, fetchActivities, fetchObservations]);

  // Busca vai para a API (param `search`), então precisa de debounce.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function saveObs() {
    if (!activeActivityId || obsValue.trim() === "") {
      closeObsModal();
      return;
    }

    // O comentário também entra no histórico, que precisa do retrato da
    // atividade — sem ele a tela de histórico só teria o id da mensagem.
    const snapshot = activitySnapshot(
      activities.find((item) => item.id === activeActivityId),
      groupId
    );
    const payload = { text: obsValue.trim(), ...snapshot };

    try {
      if (editingNoteId) {
        const res = await fetch("/api/cgc/observations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
          body: JSON.stringify({ id: editingNoteId, ...payload }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setObservations((prev) =>
          prev.map((note) => (note.id === editingNoteId ? data.observation : note))
        );
      } else {
        const res = await fetch("/api/cgc/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
          body: JSON.stringify({ message_id: activeActivityId, ...payload }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setObservations((prev) => [...prev, data.observation]);
      }
      closeObsModal();
    } catch {
      setStatusError("Não foi possível salvar o comentário.");
    }
  }

  async function deleteObs(id: string) {
    const note = observations.find((item) => item.id === id);
    const snapshot = activitySnapshot(
      activities.find((item) => item.id === (note?.message_id ?? activeActivityId)),
      groupId
    );

    try {
      const res = await fetch("/api/cgc/observations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id, ...snapshot }),
      });
      if (!res.ok) return;
      setObservations((prev) => prev.filter((note) => note.id !== id));
      if (editingNoteId === id) closeObsModal();
    } catch {
      setStatusError("Não foi possível apagar o comentário.");
    }
  }

  function closeObsModal() {
    setActiveActivityId(null);
    setEditingNoteId(null);
    setObsValue("");
  }

  async function updateStatus(id: string, status: string) {
    const activity = activities.find((item) => item.id === id);
    const previous = activity?.status;
    if (previous === status) return;

    setSavingStatusId(id);
    setStatusError(null);
    // Atualiza otimista: o seletor responde na hora e reverte se a gravação falhar.
    setActivities((prev) =>
      prev.map((activity) => (activity.id === id ? { ...activity, status } : activity))
    );

    try {
      const res = await fetch("/api/cgc/activities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        // O histórico guarda o retrato da atividade: a mensagem vive na API
        // SASI e pode sair da janela de consulta depois.
        body: JSON.stringify({ id, status, ...activitySnapshot(activity, groupId) }),
      });
      if (!res.ok) throw new Error("Falha ao salvar o status.");
      // Contadores dos cards de grupo vêm do banco local; recarrega para o
      // número de concluídas acompanhar a mudança.
      fetchGroups();
    } catch {
      if (previous) {
        setActivities((prev) =>
          prev.map((activity) =>
            activity.id === id ? { ...activity, status: previous } : activity
          )
        );
      }
      setStatusError("Não foi possível salvar o status. O valor anterior foi restaurado.");
    } finally {
      setSavingStatusId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, border: "3px solid #2A3045",
            borderTopColor: "#3B6EF5", borderRadius: "50%",
            animation: "spin 0.8s linear infinite", margin: "0 auto 16px"
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: "#E8EAF0", fontSize: 14 }}>Autenticando...</p>
        </div>
      </div>
    );
  }

  if (authError || !user) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          background: "#181C27", border: "1px solid #2A1A1A",
          borderRadius: 12, padding: "40px 48px", textAlign: "center", maxWidth: 400
        }}>
          <Lock size={36} color="#F87171" style={{ marginBottom: 16 }} />
          <h2 style={{ color: "#F87171", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Acesso negado
          </h2>
          <p style={{ color: "#E8EAF0", fontSize: 14, lineHeight: 1.6 }}>
            Token inválido ou não informado. Acesse o sistema pelo link de acesso fornecido.
          </p>
          {!token && (
            <p style={{ color: "#E8EAF0", fontSize: 12, marginTop: 12, fontFamily: "monospace" }}>
              URL esperada: /atividades-cgc?sasi-token=SEU_TOKEN
            </p>
          )}
        </div>
      </div>
    );
  }

  const header = (
    <header className="app-header">
      <div className="app-header-inner" style={{ flexDirection: "row", flexWrap: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 0 auto" }}>
          {groupId && (
            <Link
              href="/atividades-cgc"
              style={{
                color: "#E8EAF0", fontSize: 13, textDecoration: "none",
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap"
              }}
            >
              <ArrowLeft size={14} /> Grupos
            </Link>
          )}
          <span style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>
            {groupId ? (group?.name || "Atividades da CGC") : "Atividades da CGC"}
          </span>
        </div>
        <div className="app-nav" style={{ flexWrap: "nowrap", width: "auto" }}>
          <Link
            href="/atividades-cgc/historico"
            style={{
              color: "#E8EAF0", fontSize: 13, textDecoration: "none",
              padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap"
            }}
          >
            <History size={14} /> Histórico
          </Link>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 10px", background: "#1E2333",
            borderRadius: 6, border: "1px solid #2A3045", flexShrink: 0
          }}>
            <User size={14} color="#E8EAF0" />
            <span style={{ color: "#E8EAF0", fontSize: 13, whiteSpace: "nowrap" }}>
              {user.name.split(" ")[0]}
            </span>
          </div>
        </div>
      </div>
    </header>
  );

  // --- Seleção de grupo -----------------------------------------------------
  if (!groupId) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh" }}>
        {header}
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: 0 }}>Atividades por Grupo:</h1>
          </div>

          {apiError && (
            <div style={{ background: "#181C27", border: "1px solid #2A1A1A", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: "#F87171", fontSize: 13, margin: 0 }}>{apiError}</p>
            </div>
          )}

          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 24px", background: "#181C27", borderRadius: 12, border: "1px solid #2A3045" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#E8EAF0" }}>Nenhum grupo cadastrado</h2>
              <p style={{ margin: 0, color: "#E8EAF0", fontSize: 14 }}>
                Crie um grupo para definir quais atividades do CGC ele acompanha.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {sortGroupsByDisplayOrder(groups).map((item) => {
                const color = getCgcGroupColor(item.name);
                const configured = Boolean(
                  item.channel_ids || item.data_field_value || item.category_ids ||
                  item.team_name || item.app_ids
                );

                const total = item.total ?? 0;
                const concluded = item.concluded ?? 0;
                const pct = total > 0 ? Math.round((concluded / total) * 100) : 0;

                return (
                  <div
                    key={item.id}
                    className="split-card"
                    style={{
                      background: "#181C27", border: "1px solid #2A3045", borderRadius: 10,
                      padding: 12
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0 }}>
                        <span style={{
                          display: "inline-block", background: color, color: "#FFFFFF",
                          fontSize: 13, fontWeight: 800, padding: "4px 12px", borderRadius: 6
                        }}>
                          {item.name}
                        </span>
                      </h2>
                      {!configured ? (
                        <p style={{ margin: "6px 0 0", color: "#F59E0B", fontSize: 12 }}>
                          Grupo ainda não configurado
                        </p>
                      ) : (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ color: "#E8EAF0", fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{total}</div>
                              <div style={{ color: "#E8EAF0", fontSize: 10, marginTop: 3 }}>
                                {total === 1 ? "atividade solicitada" : "atividades solicitadas"}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: "#34D399", fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{concluded}</div>
                              <div style={{ color: "#E8EAF0", fontSize: 10, marginTop: 3 }}>
                                {concluded === 1 ? "atividade concluída" : "atividades concluídas"}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                            <div style={{ height: 6, background: "#1E2333", borderRadius: 999, overflow: "hidden", width: 180, maxWidth: "100%" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: "#34D399", borderRadius: 999, transition: "width 0.4s ease" }} />
                            </div>
                            <span style={{ color: "#E8EAF0", fontSize: 11, fontWeight: 700 }}>{pct}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="card-actions">
                      <Link
                        href={hrefWithParams("/atividades-cgc", { grupo: item.id })}
                        style={{ background: "#1E2333", border: "1px solid #3B6EF5", color: "#E8EAF0", borderRadius: 8, padding: "7px 12px", textDecoration: "none", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <ExternalLink size={13} /> <span className="btn-label-desktop">Abrir</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  // --- Listagem de atividades ----------------------------------------------
  const observationsByActivity = observations.reduce<Record<string, Observation[]>>((acc, note) => {
    acc[note.message_id] = acc[note.message_id] || [];
    acc[note.message_id].push(note);
    return acc;
  }, {});

  const filtered = activities.filter(
    (activity) => statusFilter === "TODOS" || activity.status === statusFilter
  );
  const grouped = groupByCategory(sortByStatus(filtered));
  const showCategoryHeaders = filtered.some((activity) => Boolean(activity.category));

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh" }}>
      {header}

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {/* Filtros */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Buscar atividade..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{
                width: "100%", background: "#181C27", border: "1px solid #2A3045",
                borderRadius: 8, padding: "8px 12px 8px 36px", color: "#E8EAF0",
                fontSize: 13, outline: "none"
              }}
            />
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#E8EAF0" }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["TODOS", "NAO_INICIADO", "EM_ANDAMENTO", "CONCLUIDO"].map((value) => {
              const option = STATUS_OPTIONS.find((s) => s.value === value);
              const isActive = statusFilter === value;
              return (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  style={{
                    padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                    border: `1px solid ${isActive ? (option?.color || "#3B6EF5") : "#2A3045"}`,
                    background: isActive ? (option ? `${option.color}20` : "#3B6EF520") : "transparent",
                    color: isActive ? (option?.color || "#3B6EF5") : "#E8EAF0",
                    cursor: "pointer", transition: "all 0.15s"
                  }}
                >
                  {value === "TODOS" ? "Todos" : option?.label}
                </button>
              );
            })}
          </div>
        </div>

        {apiError && (
          <div style={{ background: "#181C27", border: "1px solid #2A1A1A", borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h2 style={{ color: "#F87171", fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
              Não foi possível carregar as atividades
            </h2>
            <p style={{ color: "#E8EAF0", fontSize: 13, margin: "0 0 16px", lineHeight: 1.6 }}>{apiError}</p>
            <button
              onClick={() => fetchActivities({ showIndicator: true })}
              disabled={refreshing}
              style={{ background: "#3B6EF5", border: "none", color: "white", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: refreshing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={14} className={refreshing ? "spin-icon" : undefined} /> {refreshing ? "Tentando..." : "Tentar novamente"}
            </button>
          </div>
        )}

        {unconfigured && !apiError && (
          <div style={{ background: "#181C27", border: "1px solid #3A3020", borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h2 style={{ color: "#F59E0B", fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
              Grupo não configurado
            </h2>
            <p style={{ color: "#E8EAF0", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
              Este grupo ainda não tem canal nem valor identificador. Sem isso ele listaria todas as
              atividades do provider, então nenhuma consulta é feita. Edite o grupo para definir o recorte.
            </p>
          </div>
        )}

        {truncated && !apiError && (
          <p style={{ color: "#F59E0B", fontSize: 12, marginBottom: 12 }}>
            Mostrando apenas as atividades mais recentes. Use a busca para encontrar as demais.
          </p>
        )}

        {statusError && (
          <p style={{ color: "#F87171", fontSize: 12, marginBottom: 12 }}>{statusError}</p>
        )}

        {skipped > 0 && !apiError && (
          <p style={{ color: "#E8EAF0", fontSize: 12, marginBottom: 12 }}>
            {skipped === 1 ? "1 atividade não pôde" : `${skipped} atividades não puderam`} ser exibida
            {skipped === 1 ? "" : "s"}.
          </p>
        )}

        {/* Lista */}
        {!apiError && !unconfigured && Object.keys(grouped).length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 24px", background: "#181C27", borderRadius: 12, border: "1px solid #2A3045" }}>
            <p style={{ color: "#E8EAF0", fontSize: 15 }}>Nenhuma atividade encontrada</p>
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => {
            const catColor = getCgcGroupColor(group?.name);
            const catStats = getStats(items);
            return (
              <div key={category} style={{ marginBottom: 20 }}>
                {/* Sem categoria real vinda da API, o cabeçalho seria o mesmo
                    texto repetido — nesse caso a lista fica direta. */}
                {showCategoryHeaders && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 8, paddingBottom: 8, borderBottom: `2px solid ${catColor}30`,
                    gap: 12, flexWrap: "wrap"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ width: 3, height: 18, background: catColor, borderRadius: 2 }} />
                      <span style={{ color: "#E8EAF0", fontWeight: 600, fontSize: 14 }}>{category}</span>
                      <span style={{ color: "#E8EAF0", fontSize: 12 }}>({items.length})</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "#34D399", fontSize: 12 }}>{catStats.done}/{catStats.total}</span>
                      <div style={{ width: 60, height: 4, background: "#1E2333", borderRadius: 2 }}>
                        <div style={{
                          width: `${catStats.total > 0 ? (catStats.done / catStats.total) * 100 : 0}%`,
                          height: "100%", background: catColor, borderRadius: 2, transition: "width 0.3s"
                        }} />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {items.map((activity) => {
                    const st = getStatusStyle(activity.status);
                    const isSavingThis = savingStatusId === activity.id;
                    const priority = getPriorityStyle(activity.priority.level);
                    const deadlineLabel = activity.deadline
                      ? formatDate(activity.deadline.iso) || activity.deadline.label
                      : null;
                    const overdue = isOverdue(activity.deadline?.iso ?? null);

                    return (
                      <div
                        key={activity.id}
                        style={{
                          background: "#181C27", border: "1px solid #2A3045",
                          borderRadius: 8, padding: "9px 14px",
                          borderLeft: `3px solid ${st.border}`
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <p style={{
                              color: activity.incomplete ? "#E8EAF0" : "#E8EAF0",
                              fontSize: 13, margin: 0, lineHeight: 1.5,
                              fontStyle: activity.incomplete ? "italic" : "normal"
                            }}>
                              {activity.description}
                            </p>

                            {activity.fields.length > 0 && (
                              <>
                                <button
                                  onClick={() => toggleFields(activity.id)}
                                  style={{
                                    background: "transparent", border: "none", padding: 0, marginTop: 8,
                                    color: "#60A5FA", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                    display: "inline-flex", alignItems: "center", gap: 4
                                  }}
                                >
                                  {expandedFieldIds.has(activity.id)
                                    ? (<><ChevronUp size={12} /> Ocultar detalhes</>)
                                    : (<><ChevronDown size={12} /> Ver detalhes ({activity.fields.length})</>)}
                                </button>
                                {expandedFieldIds.has(activity.id) && (
                                  <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                                    {activity.fields.map((field) => (
                                      <div key={`${activity.id}-${field.name ?? field.title}`} className="field-row">
                                        <span style={{ color: "#E8EAF0", fontSize: 11, fontWeight: 500, wordBreak: "break-word" }}>
                                          {field.title || field.name}
                                        </span>
                                        <span style={{ color: "#E8EAF0", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                          {field.value}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}

                            {(observationsByActivity[activity.id] || []).map((note) => (
                              <div key={note.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
                                <p style={{ color: "#E8EAF0", fontSize: 12, margin: 0, fontStyle: "italic", flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, display: "flex", alignItems: "flex-start", gap: 5 }}>
                                  <MessageSquare size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {note.text}
                                </p>
                                <button
                                  onClick={() => {
                                    setActiveActivityId(activity.id);
                                    setEditingNoteId(note.id);
                                    setObsValue(note.text);
                                  }}
                                  title="Editar comentário"
                                  style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: "#60A5FA", display: "flex" }}
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => deleteObs(note.id)}
                                  title="Apagar comentário"
                                  style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: "#F87171", display: "flex" }}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "2px 8px",
                                background: priority.bg, color: priority.color, border: `1px solid ${priority.border}`
                              }}>
                                {activity.priority.label}
                              </span>
                              <span style={{
                                fontSize: 11, borderRadius: 4, padding: "2px 8px",
                                background: overdue ? "#2A1A1A" : "#1E2333",
                                color: overdue ? "#F87171" : deadlineLabel ? "#E8EAF0" : "#E8EAF0",
                                border: `1px solid ${overdue ? "#DC2626" : "#2A3045"}`
                              }}>
                                {deadlineLabel ? `Prazo: ${deadlineLabel}` : "Sem prazo"}
                              </span>
                              {activity.contact && (
                                <span style={{ fontSize: 11, color: "#E8EAF0" }}>{activity.contact}</span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                            <div style={{ position: "relative" }}>
                              <select
                                value={activity.status}
                                onChange={(e) => updateStatus(activity.id, e.target.value)}
                                disabled={isSavingThis}
                                style={{
                                  background: st.bg, border: `1px solid ${st.border}`,
                                  color: st.text, borderRadius: 6, padding: "5px 28px 5px 10px",
                                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                                  outline: "none", opacity: isSavingThis ? 0.6 : 1
                                }}
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>

                            <button
                              onClick={() => {
                                setActiveActivityId(activity.id);
                                setEditingNoteId(null);
                                setObsValue("");
                              }}
                              title="Novo comentário"
                              style={{
                                background: "transparent", border: "1px solid #2A3045",
                                borderRadius: 6, padding: "5px 8px", cursor: "pointer", display: "flex",
                                color: (observationsByActivity[activity.id] || []).length > 0 ? "#60A5FA" : "#E8EAF0"
                              }}
                            >
                              <MessageSquare size={14} />
                            </button>

                            {isSavingThis && (
                              <div style={{
                                width: 16, height: 16, border: "2px solid #2A3045",
                                borderTopColor: "#3B6EF5", borderRadius: "50%",
                                animation: "spin 0.6s linear infinite"
                              }} />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        {/* Paginação */}
        {!apiError && (page > 1 || hasMore) && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 24 }}>
            <button
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page === 1 || refreshing}
              style={{
                background: "transparent", border: "1px solid #2A3045", color: page === 1 ? "#E8EAF0" : "#E8EAF0",
                borderRadius: 6, padding: "8px 14px", fontSize: 13,
                cursor: page === 1 || refreshing ? "not-allowed" : "pointer"
              }}
            >
              Anterior
            </button>
            <span style={{ color: "#E8EAF0", fontSize: 13 }}>Página {page}</span>
            <button
              onClick={() => setPage((prev) => prev + 1)}
              disabled={!hasMore || refreshing}
              style={{
                background: "transparent", border: "1px solid #2A3045", color: hasMore ? "#E8EAF0" : "#E8EAF0",
                borderRadius: 6, padding: "8px 14px", fontSize: 13,
                cursor: !hasMore || refreshing ? "not-allowed" : "pointer"
              }}
            >
              Próxima
            </button>
          </div>
        )}
      </main>

      {activeActivityId !== null && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 20
          }}
          onClick={(e) => e.target === e.currentTarget && closeObsModal()}
        >
          <div style={{
            background: "#1E2333", border: "1px solid #2A3045",
            borderRadius: 12, padding: 24, width: "100%", maxWidth: 480
          }}>
            <h3 style={{ color: "#E8EAF0", fontSize: 16, fontWeight: 600, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
              <MessageSquare size={16} /> {editingNoteId ? "Editar comentário" : "Novo comentário"}
            </h3>
            <p style={{ color: "#E8EAF0", fontSize: 12, margin: "0 0 16px" }}>
              Visível só nesta tela, junto do histórico da atividade.
            </p>
            <textarea
              value={obsValue}
              onChange={(e) => setObsValue(e.target.value)}
              placeholder="Adicione um comentário sobre esta atividade..."
              autoFocus
              rows={4}
              style={{
                width: "100%", background: "#181C27", border: "1px solid #2A3045",
                borderRadius: 8, padding: "10px 12px", color: "#E8EAF0",
                fontSize: 13, outline: "none", resize: "vertical",
                fontFamily: "Inter, system-ui, sans-serif"
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
              <button
                onClick={closeObsModal}
                style={{ background: "transparent", border: "none", padding: 8, color: "#E8EAF0", fontSize: 13, cursor: "pointer" }}
              >
                Cancelar
              </button>
              {editingNoteId && (
                <button
                  onClick={() => deleteObs(editingNoteId)}
                  style={{ background: "transparent", border: "none", padding: 8, color: "#F87171", fontSize: 13, cursor: "pointer" }}
                >
                  Apagar
                </button>
              )}
              <button
                onClick={saveObs}
                style={{
                  background: "#3B6EF5", border: "none", borderRadius: 8,
                  padding: "8px 20px", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer"
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin-icon { animation: spin 0.8s linear infinite; }`}</style>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AtividadesCgcPage />
    </Suspense>
  );
}
