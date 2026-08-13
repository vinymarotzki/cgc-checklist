"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readSasiToken, sasiTokenQuery } from "@/lib/token";
import { STATUS_LABELS, getStatusColor, getStatusPillStyle } from "@/lib/checklist-status";

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
  { prefix: "Observação adicionada:", label: "Comentário criado", color: "#60A5FA", icon: "💬" },
  { prefix: "Observação editada:", label: "Comentário editado", color: "#F59E0B", icon: "✏️" },
  { prefix: "Observação apagada:", label: "Comentário apagado", color: "#F87171", icon: "🗑️" },
];

function getObservationEvent(observation: string | null) {
  if (!observation) return null;
  return OBSERVATION_EVENTS.find((event) => observation.startsWith(event.prefix)) || null;
}

/** Rótulo, cor e texto de um evento do histórico, seja status ou comentário. */
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
    icon: statusChanged ? "🔄" : "📝",
    text,
    statusChanged,
  };
}

interface CgcActivityGroup {
  messageId: string;
  title: string;
  groupName: string;
  priority: string | null;
  deadline: string | null;
  entries: CgcHistoryEntry[];
  lastAt: string;
  currentStatus: string | null;
}

/** Primeiro valor não vazio do campo entre os eventos, do mais recente ao mais antigo. */
function pickLatest(
  entries: CgcHistoryEntry[],
  field: "description" | "group_name" | "priority" | "deadline"
): string | null {
  return entries.find((entry) => entry[field])?.[field] ?? null;
}

/**
 * Agrupa o histórico por atividade (mensagem do SASI) para que cada dropdown
 * seja uma atividade. listHistory devolve created_at DESC, então a primeira
 * entrada de cada grupo já é a mais recente.
 *
 * Título, grupo, prioridade e prazo saem do evento mais recente que os tenha,
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
    priority: pickLatest(groupEntries, "priority"),
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
  const searchParams = useSearchParams();
  // Token só é aceito em `sasi-token`; qualquer outra forma é usuário sem acesso.
  const token = readSasiToken(searchParams);

  const [history, setHistory] = useState<CgcHistoryEntry[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Cada atividade é um dropdown fechado por padrão; abrir revela tudo que
  // aconteceu com ela (status alterado, comentário criado/editado/apagado).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const query = useMemo(() => sasiTokenQuery(token), [token]);

  const backHref = `/atividades-cgc${query}`;

  const fetchHistory = useCallback(async () => {
    if (!token) {
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
  }, [query, token]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const term = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      term
        ? history.filter((entry) =>
            [entry.description, entry.group_name, entry.user_name, entry.observation]
              .some((value) => value?.toLowerCase().includes(term))
          )
        : history,
    [history, term]
  );

  const activityGroups = useMemo(() => groupByActivity(filtered), [filtered]);

  // Durante uma busca não faz sentido obrigar o usuário a abrir grupo por grupo
  // para ver o que casou com o termo.
  useEffect(() => {
    if (!term) return;
    setOpenGroups(new Set(activityGroups.map((group) => group.messageId)));
  }, [term, activityGroups]);

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

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Alterações por atividade</h2>
          </div>

          <div className="history-search">
            <input
              className="history-search-input"
              type="text"
              placeholder="Buscar por atividade, grupo, usuário ou comentário..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>

          {activityGroups.length === 0 ? (
            <div className="history-empty-state">
              <p>
                {history.length === 0
                  ? "Nenhuma alteração registrada ainda."
                  : "Nenhum resultado encontrado."}
              </p>
            </div>
          ) : (
            <>
              <div className="history-groups-toolbar">
                <span className="history-groups-summary">
                  {activityGroups.length === 1 ? "1 atividade" : `${activityGroups.length} atividades`}
                  {" · "}
                  {filtered.length === 1 ? "1 alteração" : `${filtered.length} alterações`}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="history-toolbar-button"
                    onClick={() => setOpenGroups(new Set(activityGroups.map((group) => group.messageId)))}
                  >
                    Expandir tudo
                  </button>
                  <button
                    type="button"
                    className="history-toolbar-button"
                    onClick={() => setOpenGroups(new Set())}
                  >
                    Recolher tudo
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
                            {group.priority && (
                              <span className="history-category-badge">{group.priority}</span>
                            )}
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
                        <span className="history-group-caret" data-open={isOpen}>▼</span>
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
                                    <span aria-hidden="true">{info.icon}</span>
                                    {info.label}
                                  </span>
                                  <span className="history-event-time">{formatDate(entry.created_at)}</span>
                                </div>

                                {info.statusChanged && (
                                  <div className="history-status-row">
                                    <span className="history-status-pill" style={getStatusPillStyle(entry.old_status)}>
                                      {STATUS_LABELS[entry.old_status || "SEM_STATUS"] || entry.old_status || "—"}
                                    </span>
                                    <span style={{ color: "#7A82A0", fontSize: 14 }}>→</span>
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
