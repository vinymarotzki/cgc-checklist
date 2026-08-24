"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { sasiAuthHeaders } from "@/lib/token";
import { useSasiToken } from "@/hooks/useSasiToken";
import { STATUS_LABELS, getStatusColor, getStatusPillStyle } from "@/lib/checklist-status";
import {
  Lock, ArrowLeft, History, MessageSquare, Pencil, Trash2, RefreshCw,
  FileText, ChevronDown, ChevronUp, User, type LucideIcon,
} from "lucide-react";

interface CgcHistoryEntry {
  id: string;
  message_id: string;
  group_name: string | null;
  description: string | null;
  deadline: string | null;
  old_status: string | null;
  new_status: string | null;
  observation: string | null;
  user_name: string | null;
  created_at: string;
}

interface GroupSummary {
  id: string;
  name: string;
  concluded: number;
  total: number;
}

interface User {
  id: string;
  name: string;
}

/** Mesmos prefixos usados pelo histórico do checklist. */
const OBSERVATION_EVENTS: { prefix: string; label: string; color: string; icon: LucideIcon }[] = [
  { prefix: "Observação adicionada:", label: "Comentário criado", color: "#60A5FA", icon: MessageSquare },
  { prefix: "Observação editada:", label: "Comentário editado", color: "#F59E0B", icon: Pencil },
  { prefix: "Observação apagada:", label: "Comentário apagado", color: "#F87171", icon: Trash2 },
];

function getObservationEvent(observation: string | null) {
  if (!observation) return null;
  return OBSERVATION_EVENTS.find((event) => observation.startsWith(event.prefix)) || null;
}

/** Rótulo, cor e texto de um evento do histórico, seja status ou comentário. */
/**
 * Intervalo de sincronização automática, mesmo valor de /atividades-cgc — sem
 * isso os cards (concluídas por grupo, contadores) só atualizavam com reload
 * manual da página, ao contrário da listagem principal.
 */
const REFRESH_INTERVAL_MS = 15000;

function describeEntry(entry: CgcHistoryEntry) {
  const event = getObservationEvent(entry.observation);
  const text = event
    ? entry.observation?.slice(event.prefix.length).trim() || null
    : entry.observation;
  const statusChanged = !event && entry.old_status !== entry.new_status;

  if (event) {
    return { label: event.label, color: event.color, icon: event.icon, text, statusChanged };
  }
  return {
    label: statusChanged ? "Status alterado" : "Registro",
    color: getStatusColor(entry.new_status || "SEM_STATUS"),
    icon: statusChanged ? RefreshCw : FileText,
    text,
    statusChanged,
  };
}

interface CgcActivityGroup {
  messageId: string;
  title: string;
  groupName: string;
  deadline: string | null;
  entries: CgcHistoryEntry[];
  lastAt: string;
  currentStatus: string | null;
}

/** Primeiro valor não vazio do campo entre os eventos, do mais recente ao mais antigo. */
function pickLatest(
  entries: CgcHistoryEntry[],
  field: "description" | "group_name" | "deadline"
): string | null {
  return entries.find((entry) => entry[field])?.[field] ?? null;
}

/**
 * Agrupa o histórico por atividade (mensagem do SASI) para que cada dropdown
 * seja uma atividade. listHistory devolve created_at DESC, então a primeira
 * entrada de cada grupo já é a mais recente.
 *
 * Título, grupo e prazo saem do evento mais recente que os tenha,
 * e não do primeiro: são denormalizados em cgc_history a partir do snapshot que
 * a tela envia, e eventos gravados sem snapshot (comentários apagados antes da
 * correção) têm esses campos nulos — herdá-los evita cair no id da mensagem.
 */
function groupByActivity(entries: CgcHistoryEntry[]): CgcActivityGroup[] {
  const groups = new Map<string, CgcHistoryEntry[]>();

  entries.forEach((entry) => {
    const existing = groups.get(entry.message_id);
    if (existing) {
      existing.push(entry);
      return;
    }
    groups.set(entry.message_id, [entry]);
  });

  return Array.from(groups.entries()).map(([messageId, groupEntries]) => ({
    messageId,
    title: pickLatest(groupEntries, "description") || `Atividade ${messageId}`,
    groupName: pickLatest(groupEntries, "group_name") || "—",
    deadline: pickLatest(groupEntries, "deadline"),
    entries: groupEntries,
    lastAt: groupEntries[0].created_at,
    currentStatus:
      groupEntries.find((entry) => entry.new_status && entry.new_status !== "SEM_STATUS")
        ?.new_status ?? null,
  }));
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function CgcHistoryPage() {
  const token = useSasiToken();

  const [history, setHistory] = useState<CgcHistoryEntry[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  // Cada atividade é um dropdown fechado por padrão; abrir revela tudo que
  // aconteceu com ela (status alterado, comentário criado/editado/apagado).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const backHref = "/atividades-cgc";

  const fetchHistory = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/cgc/history", { headers: sasiAuthHeaders(token) });
      if (!res.ok) {
        setAuthError(true);
        return;
      }
      const data = await res.json();
      setHistory(Array.isArray(data.history) ? data.history : []);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setUser(data.user ?? null);
    } catch {
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchHistory();

    const timer = setInterval(fetchHistory, REFRESH_INTERVAL_MS);
    // Voltar para a aba é o momento em que o usuário mais espera ver o novo.
    const syncOnReturn = () => {
      if (document.visibilityState === "visible") fetchHistory();
    };
    window.addEventListener("focus", syncOnReturn);
    document.addEventListener("visibilitychange", syncOnReturn);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", syncOnReturn);
      document.removeEventListener("visibilitychange", syncOnReturn);
    };
  }, [fetchHistory]);

  const activityGroups = useMemo(() => groupByActivity(history), [history]);

  const inProgressCount = useMemo(
    () => activityGroups.filter((group) => group.currentStatus === "EM_ANDAMENTO").length,
    [activityGroups]
  );
  const blockedCount = useMemo(
    () => activityGroups.filter((group) => group.currentStatus === "IMPEDIDO").length,
    [activityGroups]
  );

  const toggleGroup = (messageId: string) => {
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", color: "#E8EAF0" }}>
        Carregando histórico...
      </div>
    );
  }

  if (authError || !user) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ background: "#181C27", border: "1px solid #2A1A1A", borderRadius: 12, padding: 32, maxWidth: 420, textAlign: "center" }}>
          <Lock size={36} color="#F87171" style={{ marginBottom: 16 }} />
          <h1 style={{ color: "#F87171", fontSize: 20, margin: "0 0 8px" }}>Acesso negado</h1>
          <p style={{ color: "#E8EAF0", fontSize: 14, margin: 0 }}>Token inválido ou não informado.</p>
        </div>
      </div>
    );
  }

  const totalConcluded = groups.reduce((sum, group) => sum + group.concluded, 0);

  return (
    <div className="page-shell">
      <header className="history-header">
        <div className="history-header-inner" style={{ flexDirection: "row", flexWrap: "nowrap" }}>
          <div className="history-header-left" style={{ width: "auto", flex: "0 0 auto" }}>
            <Link href={backHref} className="history-back-link" style={{ whiteSpace: "nowrap" }}>
              <ArrowLeft size={14} /> Voltar
            </Link>
          </div>
          <div className="history-header-main" style={{ flexWrap: "nowrap", width: "auto", minWidth: 0 }}>
            <span className="history-page-title" style={{ width: "auto", whiteSpace: "nowrap" }}>
              <History size={15} /> Histórico
            </span>
            <div className="history-user-badge" style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 10px", background: "#1E2333",
              borderRadius: 6, border: "1px solid #2A3045",
              width: "auto", flexShrink: 0
            }}>
              <User size={14} color="#E8EAF0" />
              <span style={{ color: "#E8EAF0", fontSize: 13, whiteSpace: "nowrap" }}>
                {user.name.split(" ")[0]}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="page-container">
        <div className="history-stats-grid">
          <div className="history-stat-card">
            <div className="history-stat-value" style={{ color: getStatusColor("IMPEDIDO") }}>
              {blockedCount}
            </div>
            <div className="history-stat-label">Atividades paradas</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value" style={{ color: getStatusColor("EM_ANDAMENTO") }}>
              {inProgressCount}
            </div>
            <div className="history-stat-label">Atividades em andamento</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value" style={{ color: getStatusColor("CONCLUIDO") }}>
              {totalConcluded}
            </div>
            <div className="history-stat-label">Atividades concluídas</div>
          </div>
        </div>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Concluídas por grupo</h2>
          </div>
          {groups.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhum grupo cadastrado ainda.</p>
            </div>
          ) : (
            <div className="history-completions-list" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {groups.map((group) => {
                const pct = group.total > 0 ? Math.round((group.concluded / group.total) * 100) : 0;
                return (
                  <div key={group.id} className="history-completion-card">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="history-completion-user">{group.name}</div>
                      <div className="history-completion-meta">
                        {group.concluded === 1 ? "1 atividade concluída" : `${group.concluded} atividades concluídas`}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <div style={{ height: 6, background: "#1E2333", borderRadius: 999, overflow: "hidden", width: 120, maxWidth: "100%" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#34D399", borderRadius: 999, transition: "width 0.4s ease" }} />
                        </div>
                        <span style={{ color: "#E8EAF0", fontSize: 11, fontWeight: 700 }}>{pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Alterações por atividade</h2>
          </div>

          {activityGroups.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhuma alteração registrada ainda.</p>
            </div>
          ) : (
            <>
              <div className="history-groups-toolbar">
                <span className="history-groups-summary">
                  {activityGroups.length === 1 ? "1 atividade" : `${activityGroups.length} atividades`}
                  {" · "}
                  {history.length === 1 ? "1 alteração" : `${history.length} alterações`}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="history-toolbar-button"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    onClick={() => setOpenGroups(new Set(activityGroups.map((group) => group.messageId)))}
                  >
                    <ChevronDown size={12} /> Expandir tudo
                  </button>
                  <button
                    type="button"
                    className="history-toolbar-button"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    onClick={() => setOpenGroups(new Set())}
                  >
                    <ChevronUp size={12} /> Recolher tudo
                  </button>
                </div>
              </div>

              <div className="history-groups">
                {activityGroups.map((group) => {
                  const isOpen = openGroups.has(group.messageId);
                  const panelId = `cgc-history-group-${group.messageId}`;

                  return (
                    <div key={group.messageId} className="history-group" data-open={isOpen}>
                      <button
                        type="button"
                        className="history-group-trigger"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => toggleGroup(group.messageId)}
                      >
                        <span className="history-group-head">
                          <span className="history-group-badges">
                            <span className="history-category-badge">{group.groupName}</span>
                            {group.deadline && (
                              <span className="history-category-badge">Prazo: {group.deadline}</span>
                            )}
                            {group.currentStatus && (
                              <span className="history-status-pill" style={getStatusPillStyle(group.currentStatus)}>
                                {STATUS_LABELS[group.currentStatus] || group.currentStatus}
                              </span>
                            )}
                          </span>
                          <span className="history-group-title">{group.title}</span>
                          <span className="history-group-meta">
                            {group.entries.length === 1 ? "1 alteração" : `${group.entries.length} alterações`}
                            {" · última em "}
                            {formatDate(group.lastAt)}
                          </span>
                        </span>
                        <span className="history-group-caret" data-open={isOpen}><ChevronDown size={14} /></span>
                      </button>

                      {isOpen && (
                        <ul className="history-events" id={panelId}>
                          {group.entries.map((entry) => {
                            const info = describeEntry(entry);

                            return (
                              <li
                                key={entry.id}
                                className="history-event"
                                style={{ borderLeftColor: info.color }}
                              >
                                <div className="history-event-head">
                                  <span
                                    className="history-event-kind"
                                    style={{
                                      borderColor: info.color,
                                      color: info.color,
                                      background: `${info.color}1F`,
                                    }}
                                  >
                                    <info.icon size={12} aria-hidden="true" />
                                    {info.label}
                                  </span>
                                  <span className="history-event-time">{formatDate(entry.created_at)}</span>
                                </div>

                                {info.statusChanged && (
                                  <div className="history-status-row">
                                    <span className="history-status-pill" style={getStatusPillStyle(entry.old_status)}>
                                      {STATUS_LABELS[entry.old_status || "SEM_STATUS"] || entry.old_status || "—"}
                                    </span>
                                    <span style={{ color: "#E8EAF0", fontSize: 14 }}>→</span>
                                    <span className="history-status-pill" style={getStatusPillStyle(entry.new_status)}>
                                      {STATUS_LABELS[entry.new_status || "SEM_STATUS"] || entry.new_status || "—"}
                                    </span>
                                  </div>
                                )}

                                {info.text && (
                                  <p
                                    className="history-event-comment"
                                    style={{ marginTop: info.statusChanged ? 10 : 0 }}
                                  >
                                    {info.text}
                                  </p>
                                )}

                                <div className="history-event-user">
                                  por <strong>{entry.user_name || "—"}</strong>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CgcHistoryPage />
    </Suspense>
  );
}
