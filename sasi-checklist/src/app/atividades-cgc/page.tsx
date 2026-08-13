"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TOKEN_PARAM, readSasiToken, sasiTokenQuery } from "@/lib/token";
import {
  STATUS_OPTIONS,
  getCategoryColor,
  getStatusColor,
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
type GroupWithProgress = CgcGroup & { concluded?: number };

interface GroupFormState {
  name: string;
  channel_ids: string;
  data_field_value: string;
  data_field_name: string;
  category_ids: string;
  team_name: string;
  app_ids: string;
}

const EMPTY_GROUP_FORM: GroupFormState = {
  name: "",
  channel_ids: "",
  data_field_value: "",
  data_field_name: "",
  category_ids: "",
  team_name: "",
  app_ids: "",
};

const GROUP_FORM_FIELDS = [
  {
    key: "channel_ids",
    label: "IDs de canal",
    hint: "channel_ids — canal que entrega as atividades (ex.: 33397)",
  },
  {
    key: "data_field_value",
    label: "Valor que identifica o grupo",
    hint: "Valor procurado nos campos da mensagem (ex.: NGOA). Em branco, o grupo não é roteado por campo.",
  },
  {
    key: "data_field_name",
    label: "Campo que carrega esse valor (opcional)",
    hint: "Em branco, procura em todos os campos do formulário e do perfil.",
  },
  {
    key: "category_ids",
    label: "IDs de categoria (opcional)",
    hint: "category_ids — separados por vírgula",
  },
  {
    key: "team_name",
    label: "Nome do time (opcional)",
    hint: "team_name — valor exato de raw.team.name",
  },
  {
    key: "app_ids",
    label: "IDs de app (opcional)",
    hint: "app_ids — separados por vírgula",
  },
] as const;

const PAGE_SIZE = 50;

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
  // Token só é aceito em `sasi-token`; qualquer outra forma é usuário sem acesso.
  const token = readSasiToken(searchParams);
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

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [observations, setObservations] = useState<Observation[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [obsValue, setObsValue] = useState("");

  const query = useMemo(() => sasiTokenQuery(token), [token]);

  const hrefWithToken = useCallback(
    (path: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (token) params.set(TOKEN_PARAM, token);
      for (const [key, value] of Object.entries(extra || {})) params.set(key, value);
      const qs = params.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [token]
  );

  const fetchGroups = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      return;
    }
    try {
      const res = await fetch(`/api/cgc/groups${query}`);
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
  }, [query, token]);

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
        if (token) params.set(TOKEN_PARAM, token);
        params.set("group", groupId);
        params.set("page", String(page));
        params.set("limit", String(PAGE_SIZE));
        if (search) params.set("search", search);

        const res = await fetch(`/api/cgc/activities?${params.toString()}`);
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
      const res = await fetch(`/api/cgc/observations${query}`);
      if (!res.ok) return;
      const data = await res.json();
      setObservations(Array.isArray(data.observations) ? data.observations : []);
    } catch {
      // Comentário é acessório: falhar aqui não pode derrubar a listagem.
    }
  }, [groupId, query, token]);

  useEffect(() => {
    let active = true;
    (async () => {
      await fetchGroups();
      await fetchActivities();
      await fetchObservations();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fetchGroups, fetchActivities, fetchObservations]);

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
        const res = await fetch(`/api/cgc/observations${query}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingNoteId, ...payload }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setObservations((prev) =>
          prev.map((note) => (note.id === editingNoteId ? data.observation : note))
        );
      } else {
        const res = await fetch(`/api/cgc/observations${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`/api/cgc/observations${query}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`/api/cgc/activities${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  function openCreateModal() {
    setEditingId(null);
    setForm(EMPTY_GROUP_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(item: CgcGroup) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      channel_ids: item.channel_ids || "",
      data_field_value: item.data_field_value || "",
      data_field_name: item.data_field_name || "",
      category_ids: item.category_ids || "",
      team_name: item.team_name || "",
      app_ids: item.app_ids || "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_GROUP_FORM);
    setFormError(null);
  }

  async function saveGroup() {
    if (!form.name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/cgc/groups${query}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Falha ao salvar o grupo.");
      }
      closeModal();
      await fetchGroups();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erro inesperado ao salvar o grupo.");
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(id: string) {
    if (!confirm("Excluir este grupo? As atividades permanecem na API SASI.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/cgc/groups${query}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setGroups((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setDeletingId(null);
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
          <p style={{ color: "#7A82A0", fontSize: 14 }}>Autenticando...</p>
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
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h2 style={{ color: "#F87171", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Acesso negado
          </h2>
          <p style={{ color: "#7A82A0", fontSize: 14, lineHeight: 1.6 }}>
            Token inválido ou não informado. Acesse o sistema pelo link de acesso fornecido.
          </p>
          {!token && (
            <p style={{ color: "#4A5270", fontSize: 12, marginTop: 12, fontFamily: "monospace" }}>
              URL esperada: /atividades-cgc?sasi-token=SEU_TOKEN
            </p>
          )}
        </div>
      </div>
    );
  }

  const header = (
    <header className="app-header">
      <div className="app-header-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {groupId && (
            <Link
              href={hrefWithToken("/atividades-cgc")}
              style={{
                color: "#7A82A0", fontSize: 13, textDecoration: "none",
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045"
              }}
            >
              ← Grupos
            </Link>
          )}
          <span style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 600 }}>Atividades do CGC</span>
        </div>
        <div className="app-nav">
          <Link
            href={hrefWithToken("/atividades-cgc/historico")}
            style={{
              color: "#7A82A0", fontSize: 13, textDecoration: "none",
              padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045"
            }}
          >
            📋 Histórico
          </Link>
          <Link
            href={hrefWithToken("/checklists")}
            style={{
              color: "#7A82A0", fontSize: 13, textDecoration: "none",
              padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045"
            }}
          >
            Checklists
          </Link>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 12px", background: "#1E2333",
            borderRadius: 6, border: "1px solid #2A3045"
          }}>
            <div style={{
              width: 24, height: 24, background: "#3B6EF5",
              borderRadius: "50%", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 11, fontWeight: 700, color: "white"
            }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ color: "#E8EAF0", fontSize: 13 }}>{user.name}</span>
          </div>
        </div>
      </div>
    </header>
  );

  const groupModal = modalOpen && (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center", padding: 20, zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && closeModal()}
    >
      <div style={{ background: "#1E2333", border: "1px solid #2A3045", borderRadius: 12, padding: 24, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18, color: "#E8EAF0" }}>
          {editingId ? "Editar grupo" : "Novo grupo"}
        </h2>
        <p style={{ margin: "0 0 18px", color: "#7A82A0", fontSize: 13, lineHeight: 1.5 }}>
          O grupo define quais atividades da API SASI serão exibidas. O canal traz as mensagens; o valor
          identificador separa o que é de cada grupo. Deixe um filtro em branco para não aplicá-lo.
        </p>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#C8CAD6", marginBottom: 12 }}>
          Nome do grupo
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ex.: Vigilância Sanitária"
            style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0", outline: "none" }}
          />
        </label>

        {GROUP_FORM_FIELDS.map((field) => (
          <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#C8CAD6", marginBottom: 12 }}>
            {field.label}
            <input
              value={form[field.key]}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              placeholder={field.hint}
              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0", outline: "none" }}
            />
            <span style={{ color: "#4A5270", fontSize: 11 }}>{field.hint}</span>
          </label>
        ))}

        {formError && <p style={{ color: "#F87171", fontSize: 13, margin: "12px 0 0" }}>{formError}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={closeModal} style={{ background: "transparent", border: "none", color: "#7A82A0", padding: "9px 12px", cursor: "pointer" }}>
            Cancelar
          </button>
          <button
            onClick={saveGroup}
            disabled={!form.name.trim() || saving}
            style={{
              background: "#3B6EF5", border: "none", color: "white", borderRadius: 8,
              padding: "9px 16px", fontWeight: 700,
              cursor: !form.name.trim() || saving ? "not-allowed" : "pointer",
              opacity: !form.name.trim() || saving ? 0.65 : 1
            }}
          >
            {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar grupo"}
          </button>
        </div>
      </div>
    </div>
  );

  // --- Seleção de grupo -----------------------------------------------------
  if (!groupId) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh" }}>
        {header}
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <div>
              <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: 0 }}>Selecione um grupo</h1>
              <p style={{ color: "#7A82A0", fontSize: 13, marginTop: 4 }}>
                Escolha o grupo responsável para visualizar as atividades recebidas da API SASI.
              </p>
            </div>
            <button
              onClick={openCreateModal}
              style={{ background: "#3B6EF5", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}
            >
              + Novo Grupo
            </button>
          </div>

          {apiError && (
            <div style={{ background: "#181C27", border: "1px solid #2A1A1A", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <p style={{ color: "#F87171", fontSize: 13, margin: 0 }}>{apiError}</p>
            </div>
          )}

          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 24px", background: "#181C27", borderRadius: 12, border: "1px solid #2A3045" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#E8EAF0" }}>Nenhum grupo cadastrado</h2>
              <p style={{ margin: 0, color: "#7A82A0", fontSize: 14 }}>
                Crie um grupo para definir quais atividades do CGC ele acompanha.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {groups.map((item) => {
                const color = getCategoryColor(item.name);
                const configured = Boolean(
                  item.channel_ids || item.data_field_value || item.category_ids ||
                  item.team_name || item.app_ids
                );

                return (
                  <div
                    key={item.id}
                    className="split-card"
                    style={{
                      background: "#181C27", border: "1px solid #2A3045", borderRadius: 10,
                      padding: 18, borderLeft: `3px solid ${color}`
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0, fontSize: 16, color: "#E8EAF0" }}>{item.name}</h2>
                      {!configured ? (
                        <p style={{ margin: "6px 0 0", color: "#F59E0B", fontSize: 13 }}>
                          Grupo ainda não configurado
                        </p>
                      ) : (
                        <p style={{ margin: "6px 0 0", color: "#7A82A0", fontSize: 13 }}>
                          {(item.concluded ?? 0) === 1
                            ? "1 atividade concluída"
                            : `${item.concluded ?? 0} atividades concluídas`}
                        </p>
                      )}
                    </div>
                    <div className="card-actions">
                      <Link
                        href={hrefWithToken("/atividades-cgc", { grupo: item.id })}
                        style={{ background: "#1E2333", border: "1px solid #3B6EF5", color: "#E8EAF0", borderRadius: 8, padding: "9px 14px", textDecoration: "none", fontSize: 13, fontWeight: 700 }}
                      >
                        Abrir
                      </Link>
                      <button
                        onClick={() => openEditModal(item)}
                        style={{ background: "#3B82F6", border: "1px solid #3B6EF5", color: "#E8EAF0", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => removeGroup(item.id)}
                        disabled={deletingId === item.id}
                        style={{ background: "transparent", border: "1px solid #3A2430", color: "#F87171", borderRadius: 8, padding: "9px 12px", cursor: deletingId === item.id ? "not-allowed" : "pointer" }}
                      >
                        {deletingId === item.id ? "Excluindo..." : "Excluir"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
        {groupModal}
      </div>
    );
  }

  // --- Listagem de atividades ----------------------------------------------
  const observationsByActivity = observations.reduce<Record<string, Observation[]>>((acc, note) => {
    acc[note.message_id] = acc[note.message_id] || [];
    acc[note.message_id].push(note);
    return acc;
  }, {});

  const stats = getStats(activities);
  const notStarted = stats.total - stats.done - stats.inProgress - stats.blocked;
  const completionPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const notStartedPct = stats.total > 0 ? (notStarted / stats.total) * 100 : 0;
  const inProgressPct = stats.total > 0 ? (stats.inProgress / stats.total) * 100 : 0;
  const donePct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  const filtered = activities.filter(
    (activity) => statusFilter === "TODOS" || activity.status === statusFilter
  );
  const grouped = groupByCategory(filtered);
  const showCategoryHeaders = filtered.some((activity) => Boolean(activity.category));

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh" }}>
      {header}

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {/* Visão geral */}
        <div style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: 0 }}>
                {group?.name || "Grupo selecionado"}
              </h1>
              <p style={{ color: "#7A82A0", fontSize: 13, marginTop: 4 }}>
                {total ?? stats.total} atividades · {stats.done} concluídas
                {lastSync && (
                  <span style={{ color: "#4A5270" }}> · sincronizado {formatClock(lastSync)}</span>
                )}
              </p>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { label: "Concluídas", value: stats.done, color: "#34D399" },
                { label: "Em andamento", value: stats.inProgress, color: "#60A5FA" },
                { label: "Não iniciadas", value: notStarted, color: "#F87171" },
              ].map((stat) => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ color: stat.color, fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
                  <div style={{ color: "#4A5270", fontSize: 11, marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
              <button
                onClick={() => fetchActivities({ showIndicator: true })}
                disabled={refreshing}
                style={{
                  background: "transparent", border: "1px solid #2A3045", color: "#7A82A0",
                  borderRadius: 6, padding: "8px 14px", fontSize: 13,
                  cursor: refreshing ? "not-allowed" : "pointer"
                }}
              >
                {refreshing ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#7A82A0", fontSize: 12 }}>Progresso da página</span>
              <span style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600 }}>{completionPct}%</span>
            </div>
            <div style={{ background: "#1E2333", borderRadius: 4, height: 6, overflow: "hidden", display: "flex" }}>
              <div style={{ height: "100%", width: `${notStartedPct}%`, background: getStatusColor("NAO_INICIADO"), borderRadius: "4px 0 0 4px", transition: "width 0.5s ease" }} />
              <div style={{ height: "100%", width: `${inProgressPct}%`, background: getStatusColor("EM_ANDAMENTO"), transition: "width 0.5s ease" }} />
              <div style={{ height: "100%", width: `${donePct}%`, background: getStatusColor("CONCLUIDO"), borderRadius: "0 4px 4px 0", transition: "width 0.5s ease" }} />
            </div>
          </div>
        </div>

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
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4A5270", fontSize: 14 }}>🔍</span>
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
                    color: isActive ? (option?.color || "#3B6EF5") : "#7A82A0",
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
            <p style={{ color: "#7A82A0", fontSize: 13, margin: "0 0 16px", lineHeight: 1.6 }}>{apiError}</p>
            <button
              onClick={() => fetchActivities({ showIndicator: true })}
              disabled={refreshing}
              style={{ background: "#3B6EF5", border: "none", color: "white", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: refreshing ? "not-allowed" : "pointer" }}
            >
              {refreshing ? "Tentando..." : "Tentar novamente"}
            </button>
          </div>
        )}

        {unconfigured && !apiError && (
          <div style={{ background: "#181C27", border: "1px solid #3A3020", borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h2 style={{ color: "#F59E0B", fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
              Grupo não configurado
            </h2>
            <p style={{ color: "#7A82A0", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
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
          <p style={{ color: "#4A5270", fontSize: 12, marginBottom: 12 }}>
            {skipped === 1 ? "1 atividade não pôde" : `${skipped} atividades não puderam`} ser exibida
            {skipped === 1 ? "" : "s"}.
          </p>
        )}

        {/* Lista */}
        {!apiError && !unconfigured && Object.keys(grouped).length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 24px", background: "#181C27", borderRadius: 12, border: "1px solid #2A3045" }}>
            <p style={{ color: "#7A82A0", fontSize: 15 }}>Nenhuma atividade encontrada</p>
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => {
            const catColor = getCategoryColor(category);
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
                      <span style={{ color: "#4A5270", fontSize: 12 }}>({items.length})</span>
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
                          borderRadius: 8, padding: "12px 16px",
                          borderLeft: `3px solid ${st.border}`
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <p style={{
                              color: activity.incomplete ? "#4A5270" : "#C8CAD6",
                              fontSize: 13, margin: 0, lineHeight: 1.5,
                              fontStyle: activity.incomplete ? "italic" : "normal"
                            }}>
                              {activity.description}
                            </p>

                            {activity.fields.length > 0 && (
                              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                                {activity.fields.map((field) => (
                                  <div key={`${activity.id}-${field.name ?? field.title}`} className="field-row">
                                    <span style={{ color: "#4A5270", fontSize: 11, fontWeight: 500, wordBreak: "break-word" }}>
                                      {field.title || field.name}
                                    </span>
                                    <span style={{ color: "#C8CAD6", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                      {field.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {(observationsByActivity[activity.id] || []).map((note) => (
                              <div key={note.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
                                <p style={{ color: "#4A5270", fontSize: 12, margin: 0, fontStyle: "italic", flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                                  💬 {note.text}
                                </p>
                                <button
                                  onClick={() => {
                                    setActiveActivityId(activity.id);
                                    setEditingNoteId(note.id);
                                    setObsValue(note.text);
                                  }}
                                  title="Editar comentário"
                                  style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: "#60A5FA", fontSize: 12 }}
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => deleteObs(note.id)}
                                  title="Apagar comentário"
                                  style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: "#F87171", fontSize: 12 }}
                                >
                                  ✕
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
                                color: overdue ? "#F87171" : deadlineLabel ? "#C8CAD6" : "#4A5270",
                                border: `1px solid ${overdue ? "#DC2626" : "#2A3045"}`
                              }}>
                                {deadlineLabel ? `Prazo: ${deadlineLabel}` : "Sem prazo"}
                              </span>
                              {activity.contact && (
                                <span style={{ fontSize: 11, color: "#4A5270" }}>{activity.contact}</span>
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
                                borderRadius: 6, padding: "5px 8px", cursor: "pointer",
                                color: (observationsByActivity[activity.id] || []).length > 0 ? "#60A5FA" : "#4A5270",
                                fontSize: 13
                              }}
                            >
                              💬
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
                background: "transparent", border: "1px solid #2A3045", color: page === 1 ? "#4A5270" : "#C8CAD6",
                borderRadius: 6, padding: "8px 14px", fontSize: 13,
                cursor: page === 1 || refreshing ? "not-allowed" : "pointer"
              }}
            >
              Anterior
            </button>
            <span style={{ color: "#7A82A0", fontSize: 13 }}>Página {page}</span>
            <button
              onClick={() => setPage((prev) => prev + 1)}
              disabled={!hasMore || refreshing}
              style={{
                background: "transparent", border: "1px solid #2A3045", color: hasMore ? "#C8CAD6" : "#4A5270",
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
            <h3 style={{ color: "#E8EAF0", fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>
              {editingNoteId ? "Editar comentário" : "Novo comentário"}
            </h3>
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
                style={{ background: "transparent", border: "none", padding: 8, color: "#7A82A0", fontSize: 13, cursor: "pointer" }}
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
