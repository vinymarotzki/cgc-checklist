"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { sasiAuthHeaders } from "@/lib/token";
import { useSasiToken } from "@/hooks/useSasiToken";
import Link from "next/link";
import { Suspense } from "react";
import { STATUS_LABELS, getStatusColor, getStatusPillStyle } from "@/lib/checklist-status";
import {
  Lock, Search, ArrowLeft, History, MessageSquare, Pencil, Trash2, RefreshCw, FileText,
  ChevronDown, ChevronUp, User, type LucideIcon,
} from "lucide-react";

interface HistoryEntry {
  id: string;
  activity_id: string;
  activity: string;
  category: string;
  old_status: string;
  new_status: string;
  user_id: string;
  user_name: string;
  observation: string | null;
  created_at: string;
}

interface User {
  id: string;
  name: string;
}

const OBSERVATION_EVENT_PREFIXES: { prefix: string; label: string; color: string; icon: LucideIcon }[] = [
  { prefix: "Observação adicionada:", label: "Observação criada", color: "#60A5FA", icon: MessageSquare },
  { prefix: "Observação editada:", label: "Observação editada", color: "#F59E0B", icon: Pencil },
  { prefix: "Observação apagada:", label: "Observação apagada", color: "#F87171", icon: Trash2 },
];

function getObservationEvent(observation: string | null) {
  if (!observation) return null;
  return OBSERVATION_EVENT_PREFIXES.find((event) => observation.startsWith(event.prefix)) || null;
}

/** Rótulo, cor e texto de um evento do histórico, seja status ou observação. */
function describeEntry(entry: HistoryEntry) {
  const event = getObservationEvent(entry.observation);
  const text = event
    ? entry.observation?.slice(event.prefix.length).trim() || null
    : entry.observation;
  const statusChanged = entry.old_status !== entry.new_status;

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

interface ActivityGroup {
  activityId: string;
  title: string;
  category: string;
  entries: HistoryEntry[];
  lastAt: string;
  currentStatus: string | null;
}

/**
 * Agrupa o histórico por atividade para que cada dropdown seja uma atividade.
 * A rota devolve created_at DESC, então a primeira entrada de cada grupo é a
 * mais recente — daí lastAt e o status atual saírem direto dela.
 */
function groupByActivity(entries: HistoryEntry[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();

  entries.forEach((entry) => {
    const existing = groups.get(entry.activity_id);
    if (existing) {
      existing.entries.push(entry);
      return;
    }
    groups.set(entry.activity_id, {
      activityId: entry.activity_id,
      title: entry.activity || `Atividade ${entry.activity_id.slice(0, 8)}...`,
      category: entry.category || "—",
      entries: [entry],
      lastAt: entry.created_at,
      currentStatus: null,
    });
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    currentStatus:
      group.entries.find((entry) => entry.new_status && entry.new_status !== "SEM_STATUS")
        ?.new_status ?? null,
  }));
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function HistoryPage() {
  const token = useSasiToken();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Cada atividade é um dropdown fechado por padrão; abrir revela tudo que
  // aconteceu com ela (status alterado, observação criada/editada/apagada).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const fetchHistory = useCallback(async () => {
    if (!token) { setAuthError(true); setLoading(false); return; }
    try {
      const res = await fetch("/api/history", { headers: sasiAuthHeaders(token) });
      if (!res.ok) { setAuthError(true); setLoading(false); return; }
      const data = await res.json();
      setHistory(data.history);
      setUser(data.user);
    } catch (error) {
      console.error("Erro no fetchHistory:", error);
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const filtered = history.filter((h) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      h.activity?.toLowerCase().includes(s) ||
      h.user_name?.toLowerCase().includes(s) ||
      h.category?.toLowerCase().includes(s) ||
      h.observation?.toLowerCase().includes(s)
    );
  });

  const groups = useMemo(() => groupByActivity(filtered), [filtered]);

  // Durante uma busca não faz sentido obrigar o usuário a abrir grupo por grupo
  // para ver o que casou com o termo.
  useEffect(() => {
    if (!searchTerm.trim()) return;
    setOpenGroups(new Set(groups.map((group) => group.activityId)));
  }, [searchTerm, groups]);

  const toggleGroup = (activityId: string) => {
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(activityId)) {
        next.delete(activityId);
      } else {
        next.add(activityId);
      }
      return next;
    });
  };

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
          <p style={{ color: "#E8EAF0", fontSize: 14 }}>Carregando histórico...</p>
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
          <h2 style={{ color: "#F87171", fontSize: 20, fontWeight: 600 }}>Acesso negado</h2>
          <p style={{ color: "#E8EAF0", fontSize: 14 }}>Token inválido ou não informado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="history-header">
        <div className="history-header-inner" style={{ flexDirection: "row", flexWrap: "nowrap" }}>
          <div className="history-header-left" style={{ width: "auto", flex: "0 0 auto" }}>
            <Link
              href="/"
              className="history-back-link"
              style={{ whiteSpace: "nowrap" }}
            >
              <ArrowLeft size={14} /> Checklist
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
            <div className="history-stat-value">{history.length}</div>
            <div className="history-stat-label">Total de alterações</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">
              {history.filter((h) => h.new_status === "CONCLUIDO").length}
            </div>
            <div className="history-stat-label">Marcadas concluídas</div>
          </div>
        </div>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Alterações por atividade</h2>
          </div>

          <div className="history-search">
            <input
              className="history-search-input"
              type="text"
              placeholder="Buscar por atividade, categoria, usuário ou observação..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search size={14} className="search-icon" />
          </div>

          {groups.length === 0 ? (
            <div className="history-empty-state">
              <p>
                {history.length === 0 ? "Nenhuma alteração registrada ainda." : "Nenhum resultado encontrado."}
              </p>
            </div>
          ) : (
            <>
              <div className="history-groups-toolbar">
                <span className="history-groups-summary">
                  {groups.length === 1 ? "1 atividade" : `${groups.length} atividades`}
                  {" · "}
                  {filtered.length === 1 ? "1 alteração" : `${filtered.length} alterações`}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="history-toolbar-button"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                    onClick={() => setOpenGroups(new Set(groups.map((group) => group.activityId)))}
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
                {groups.map((group) => {
                  const isOpen = openGroups.has(group.activityId);
                  const panelId = `history-group-${group.activityId}`;

                  return (
                    <div key={group.activityId} className="history-group" data-open={isOpen}>
                      <button
                        type="button"
                        className="history-group-trigger"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => toggleGroup(group.activityId)}
                      >
                        <span className="history-group-head">
                          <span className="history-group-badges">
                            <span className="history-category-badge">{group.category}</span>
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
                                      {STATUS_LABELS[entry.old_status] || entry.old_status || "—"}
                                    </span>
                                    <span style={{ color: "#E8EAF0", fontSize: 14 }}>→</span>
                                    <span className="history-status-pill" style={getStatusPillStyle(entry.new_status)}>
                                      {STATUS_LABELS[entry.new_status] || entry.new_status || "—"}
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
                                  por <strong>{entry.user_name}</strong>
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin-icon { animation: spin 0.8s linear infinite; }`}</style>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <HistoryPage />
    </Suspense>
  );
}
