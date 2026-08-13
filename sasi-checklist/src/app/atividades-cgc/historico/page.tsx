"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { STATUS_LABELS, getStatusColor } from "@/lib/checklist-status";

interface CgcHistoryEntry {
  id: string;
  message_id: string;
  group_name: string | null;
  description: string | null;
  priority: string | null;
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
}

interface User {
  id: string;
  name: string;
}

/** Mesmos prefixos usados pelo histórico do checklist. */
const OBSERVATION_EVENTS = [
  { prefix: "Observação adicionada:", label: "Comentário criado", color: "#60A5FA" },
  { prefix: "Observação editada:", label: "Comentário editado", color: "#F59E0B" },
  { prefix: "Observação apagada:", label: "Comentário apagado", color: "#F87171" },
];

function getObservationEvent(observation: string | null) {
  if (!observation) return null;
  return OBSERVATION_EVENTS.find((event) => observation.startsWith(event.prefix)) || null;
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
  const searchParams = useSearchParams();
  const token = searchParams.get("sasi-token") || searchParams.get("token") || "";
  const isLocalDev =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

  const [history, setHistory] = useState<CgcHistoryEntry[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Todo o histórico (status alterado, comentários criados/editados/apagados)
  // fica dentro de um único dropdown, fechado por padrão.
  const [changesOpen, setChangesOpen] = useState(false);

  const query = useMemo(
    () => (token ? `?sasi-token=${encodeURIComponent(token)}` : ""),
    [token]
  );

  const backHref = token
    ? `/atividades-cgc?sasi-token=${encodeURIComponent(token)}`
    : "/atividades-cgc";

  const fetchHistory = useCallback(async () => {
    if (!token && !isLocalDev) {
      setAuthError(true);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/cgc/history${query}`);
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
  }, [isLocalDev, query, token]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", color: "#7A82A0" }}>
        Carregando histórico...
      </div>
    );
  }

  if (authError || !user) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ background: "#181C27", border: "1px solid #2A1A1A", borderRadius: 12, padding: 32, maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h1 style={{ color: "#F87171", fontSize: 20, margin: "0 0 8px" }}>Acesso negado</h1>
          <p style={{ color: "#7A82A0", fontSize: 14, margin: 0 }}>Token inválido ou não informado.</p>
        </div>
      </div>
    );
  }

  const term = searchTerm.trim().toLowerCase();
  const filtered = term
    ? history.filter((entry) =>
        [entry.description, entry.group_name, entry.user_name, entry.observation]
          .some((value) => value?.toLowerCase().includes(term))
      )
    : history;

  const totalConcluded = groups.reduce((sum, group) => sum + group.concluded, 0);

  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-nav">
            <Link href={backHref} className="history-back-link">← Atividades do CGC</Link>
            <span className="history-page-title">📋 Histórico do CGC</span>
          </div>
          <span className="history-user-badge">{user.name}</span>
        </div>
      </header>

      <main className="page-container">
        <div className="history-stats-grid">
          <div className="history-stat-card">
            <div className="history-stat-value">{totalConcluded}</div>
            <div className="history-stat-label">Atividades concluídas</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{history.length}</div>
            <div className="history-stat-label">Alterações registradas</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">
              {new Set(history.map((entry) => entry.user_name).filter(Boolean)).size}
            </div>
            <div className="history-stat-label">Responsáveis únicos</div>
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
            <div className="history-completions-list">
              {groups.map((group) => (
                <div key={group.id} className="history-completion-card">
                  <div>
                    <div className="history-completion-user">{group.name}</div>
                    <div className="history-completion-meta">
                      {group.concluded === 1 ? "1 atividade concluída" : `${group.concluded} atividades concluídas`}
                    </div>
                  </div>
                  <div className="history-completion-count">{group.concluded}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="history-collapse">
          <button
            type="button"
            className="history-collapse-trigger"
            aria-expanded={changesOpen}
            aria-controls="cgc-history-changes-panel"
            onClick={() => setChangesOpen((open) => !open)}
          >
            <span className="history-collapse-label">
              <span>Alterações, edições, exclusões e comentários</span>
              <span className="history-collapse-count">{history.length}</span>
            </span>
            <span className="history-collapse-caret" data-open={changesOpen}>▼</span>
          </button>

          {changesOpen && (
            <div className="history-collapse-body" id="cgc-history-changes-panel">
              <div className="history-search">
                <input
                  className="history-search-input"
                  type="text"
                  placeholder="Buscar no histórico..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>

              {filtered.length === 0 ? (
          <div className="history-empty-state">
            <p>
              {history.length === 0
                ? "Nenhuma alteração registrada ainda."
                : "Nenhum resultado encontrado."}
            </p>
          </div>
        ) : (
          <div className="history-list">
            {filtered.map((entry) => {
              const event = getObservationEvent(entry.observation);
              const observationText = event
                ? entry.observation?.slice(event.prefix.length).trim()
                : entry.observation;
              const statusChanged = !event && entry.old_status !== entry.new_status;

              return (
                <div
                  key={entry.id}
                  className="history-card"
                  style={{
                    borderLeftColor:
                      event?.color || getStatusColor(entry.new_status || "SEM_STATUS"),
                  }}
                >
                  <div className="history-card-content">
                    <div className="history-card-main">
                      <div className="history-category-tag">
                        <span className="history-category-badge">{entry.group_name || "—"}</span>
                      </div>

                      <p className="history-activity">
                        {entry.description || `Atividade ${entry.message_id}`}
                      </p>

                      {(entry.priority || entry.deadline) && (
                        <div className="history-status-row" style={{ marginBottom: 8 }}>
                          {entry.priority && (
                            <span className="history-category-badge">{entry.priority}</span>
                          )}
                          {entry.deadline && (
                            <span className="history-category-badge">Prazo: {entry.deadline}</span>
                          )}
                        </div>
                      )}

                      {statusChanged && (
                        <div className="history-status-row">
                          {[entry.old_status, entry.new_status].map((status, index) => (
                            <span key={`${entry.id}-${index}`} style={{ display: "contents" }}>
                              {index === 1 && <span style={{ color: "#4A5270", fontSize: 12 }}>→</span>}
                              <span
                                className="history-status-pill"
                                style={{
                                  border: `1px solid ${getStatusColor(status || "SEM_STATUS")}`,
                                  color: getStatusColor(status || "SEM_STATUS"),
                                  background: `${getStatusColor(status || "SEM_STATUS")}15`,
                                }}
                              >
                                {STATUS_LABELS[status || "SEM_STATUS"] || status || "—"}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}

                      {event && (
                        <span
                          className="history-observation-badge"
                          style={{ borderColor: event.color, color: event.color, background: `${event.color}20` }}
                        >
                          {event.label}
                        </span>
                      )}
                      {observationText && (
                        <p className="history-observation" style={{ marginTop: event ? 8 : 0 }}>
                          💬 {observationText}
                        </p>
                      )}
                    </div>

                    <div className="history-card-meta">
                      <div className="meta-name">{entry.user_name || "—"}</div>
                      <div className="meta-date">{formatDate(entry.created_at)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
              )}
            </div>
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
