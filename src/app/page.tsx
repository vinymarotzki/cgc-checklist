"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { sasiAuthHeaders } from "@/lib/token";
import { isOwner } from "@/lib/ownership";
import { useSasiToken } from "@/hooks/useSasiToken";
import LoadingScreen from "@/components/LoadingScreen";
import Link from "next/link";
import { Suspense } from "react";
import { History, ArrowLeft, Search, MessageSquare, Pencil, X, Lock, Settings, User } from "lucide-react";
import {
  STATUS_OPTIONS,
  getCategoryColor,
  getStatusColor,
  getStatusStyle,
} from "@/lib/checklist-status";

interface Activity {
  id: string;
  category: string;
  activity: string;
  status: string;
  responsible: string | null;
  observation: string | null;
}

interface User {
  id: string;
  name: string;
}

interface Observation {
  id: string;
  activity_id: string;
  text: string;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

function formatNoteDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function groupByCategory(activities: Activity[]) {
  const groups: Record<string, Activity[]> = {};
  for (const a of activities) {
    if (!groups[a.category]) groups[a.category] = [];
    groups[a.category].push(a);
  }
  return groups;
}

function getCategoryStats(activities: Activity[]) {
  const total = activities.length;
  const done = activities.filter((a) => a.status === "CONCLUIDO").length;
  const inProgress = activities.filter((a) => a.status === "EM_ANDAMENTO").length;
  const blocked = activities.filter((a) => a.status === "IMPEDIDO").length;
  return { total, done, inProgress, blocked };
}

function ChecklistPage() {
  const searchParams = useSearchParams();
  const token = useSasiToken();
  const checklistId = searchParams.get("checklist") || "";

  const [activities, setActivities] = useState<Activity[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [obsValue, setObsValue] = useState("");
  const [filter, setFilter] = useState("TODOS");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchActivities = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      setLoading(false);
      return;
    }
    try {
      if (!checklistId) {
        const authRes = await fetch("/api/checklists", { headers: sasiAuthHeaders(token) });
        if (!authRes.ok) {
          setAuthError(true);
          setLoading(false);
          return;
        }
        const authData = await authRes.json();
        setActivities([]);
        setUser(authData.user);
        setLoading(false);
        return;
      }

      const query = `?checklist=${encodeURIComponent(checklistId)}`;
      const res = await fetch(`/api/activities${query}`, { headers: sasiAuthHeaders(token) });
      if (!res.ok) {
        setAuthError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setActivities(data.activities);
      setUser(data.user);
    } catch {
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token, checklistId]);

  const fetchObservations = useCallback(async () => {
    if (!token || !checklistId) return;
    try {
      const res = await fetch(`/api/observations?checklist=${encodeURIComponent(checklistId)}`, {
        headers: sasiAuthHeaders(token),
      });
      if (!res.ok) return;
      const data = await res.json();
      setObservations(data.observations || []);
    } catch {
      // ignore
    }
  }, [token, checklistId]);

  useEffect(() => {
    fetchActivities();
    fetchObservations();
  }, [fetchActivities, fetchObservations]);

  async function updateActivity(id: string, patch: Partial<Activity>) {
    setSaving(id);
    try {
      const query = checklistId ? `?checklist=${encodeURIComponent(checklistId)}` : "";
      await fetch(`/api/activities${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id, ...patch }),
      });
      setActivities((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveObs() {
    if (!activeActivityId || obsValue.trim() === "") {
      setActiveActivityId(null);
      setEditingNoteId(null);
      return;
    }

    const payload = { text: obsValue.trim() };

    if (editingNoteId) {
      const res = await fetch("/api/observations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id: editingNoteId, ...payload }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setObservations((prev) => prev.map((note) => note.id === editingNoteId ? data.observation : note));
    } else {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ activity_id: activeActivityId, ...payload }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setObservations((prev) => [...prev, data.observation]);
    }

    setActiveActivityId(null);
    setEditingNoteId(null);
    setObsValue("");
  }

  async function deleteObs(id: string) {
    const res = await fetch("/api/observations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return;
    setObservations((prev) => prev.filter((note) => note.id !== id));
    if (editingNoteId === id) {
      setActiveActivityId(null);
      setEditingNoteId(null);
      setObsValue("");
    }
  }

  const observationsByActivity = observations.reduce<Record<string, Observation[]>>((acc, note) => {
    acc[note.activity_id] = acc[note.activity_id] || [];
    acc[note.activity_id].push(note);
    return acc;
  }, {});

  const totalStats = getCategoryStats(activities);
  const notStartedCount = totalStats.total - totalStats.done - totalStats.inProgress - totalStats.blocked;
  const completionPct = totalStats.total > 0
    ? Math.round((totalStats.done / totalStats.total) * 100)
    : 0;
  const notStartedPct = totalStats.total > 0 ? (notStartedCount / totalStats.total) * 100 : 0;
  const inProgressPct = totalStats.total > 0 ? (totalStats.inProgress / totalStats.total) * 100 : 0;
  const donePct = totalStats.total > 0 ? (totalStats.done / totalStats.total) * 100 : 0;

  const filteredActivities = activities.filter((a) => {
    const matchFilter = filter === "TODOS" || a.status === filter;
    const matchSearch = !searchTerm ||
      a.activity.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchFilter && matchSearch;
  });

  const groups = groupByCategory(filteredActivities);

  if (loading) {
    return <LoadingScreen message="Autenticando..." />;
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
              URL esperada: /?sasi-token=SEU_TOKEN
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!checklistId) {
    const checklistsHref = "/checklists";
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          background: "#181C27", border: "1px solid #2A3045",
          borderRadius: 12, padding: "36px 42px", textAlign: "center", maxWidth: 460
        }}>
          <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>
            Selecione um checklist
          </h1>
          <p style={{ color: "#E8EAF0", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            Abra a tela de checklists para escolher um cadastro ou importar uma nova planilha.
          </p>
          <Link
            href={checklistsHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#3B6EF5",
              color: "white",
              textDecoration: "none",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Ir para checklists
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh" }}>
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div />
          <div className="app-nav">
            <Link
              href="/checklists"
              style={{
                color: "#E8EAF0", fontSize: 13, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
                transition: "all 0.15s"
              }}
            >
              <ArrowLeft size={14} /> Voltar
            </Link>
            <Link
              href="/history"
              style={{
                color: "#E8EAF0", fontSize: 13, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
                transition: "all 0.15s"
              }}
            >
              <History size={14} /> Histórico
            </Link>
            <Link
              href={`/admin?checklist=${encodeURIComponent(checklistId)}`}
              style={{
                color: "#E8EAF0", fontSize: 13, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
                transition: "all 0.15s"
              }}
            >
              <Settings size={14} /> Editar
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

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {/* Progress Overview */}
        <div style={{
          background: "#181C27", border: "1px solid #2A3045",
          borderRadius: 12, padding: 24, marginBottom: 24
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: 0 }}>
                Checklist selecionado
              </h1>
              <p style={{ color: "#E8EAF0", fontSize: 13, marginTop: 4 }}>
                {totalStats.total} atividades · {totalStats.done} concluídas
              </p>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "Concluídas", value: totalStats.done, color: "#34D399" },
                { label: "Em andamento", value: totalStats.inProgress, color: "#60A5FA" },
                { label: "Impedidas", value: totalStats.blocked, color: "#F87171" },
              ].map((stat) => (
                <div key={stat.label} style={{ textAlign: "center" }}>
                  <div style={{ color: stat.color, fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
                    {stat.value}
                  </div>
                  <div style={{ color: "#E8EAF0", fontSize: 11, marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#E8EAF0", fontSize: 12 }}>Progresso geral</span>
              <span style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600 }}>{completionPct}%</span>
            </div>
            <div style={{ background: "#1E2333", borderRadius: 4, height: 6, overflow: "hidden", display: "flex" }}>
              <div style={{
                height: "100%", width: `${notStartedPct}%`,
                background: getStatusColor("NAO_INICIADO"),
                borderRadius: "4px 0 0 4px",
                transition: "width 0.5s ease"
              }} />
              <div style={{
                height: "100%", width: `${inProgressPct}%`,
                background: getStatusColor("EM_ANDAMENTO"),
                transition: "width 0.5s ease"
              }} />
              <div style={{
                height: "100%", width: `${donePct}%`,
                background: getStatusColor("CONCLUIDO"),
                borderRadius: "0 4px 4px 0",
                transition: "width 0.5s ease"
              }} />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Buscar atividade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%", background: "#181C27", border: "1px solid #2A3045",
                borderRadius: 8, padding: "8px 12px 8px 36px", color: "#E8EAF0",
                fontSize: 13, outline: "none"
              }}
            />
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#E8EAF0" }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["TODOS", "NAO_INICIADO", "EM_ANDAMENTO", "CONCLUIDO"].map((f) => {
              const opt = STATUS_OPTIONS.find((s) => s.value === f);
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                    border: `1px solid ${isActive ? (opt?.color || "#3B6EF5") : "#2A3045"}`,
                    background: isActive ? (opt ? `${opt.color}20` : "#3B6EF520") : "transparent",
                    color: isActive ? (opt?.color || "#3B6EF5") : "#7A82A0",
                    cursor: "pointer", transition: "all 0.15s"
                  }}
                >
                  {f === "TODOS" ? "Todos" : opt?.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Activity Groups */}
        {Object.keys(groups).length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 24px",
            background: "#181C27", borderRadius: 12, border: "1px solid #2A3045"
          }}>
            <p style={{ color: "#E8EAF0", fontSize: 15, margin: "0 0 16px" }}>
              {activities.length === 0 && !searchTerm && filter === "TODOS"
                ? "Este checklist ainda não tem atividades. Adicione categorias e atividades para começar."
                : "Nenhuma atividade encontrada"}
            </p>
            {activities.length === 0 && (
              <Link
                href={`/admin?checklist=${encodeURIComponent(checklistId)}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "#3B6EF5", color: "white", textDecoration: "none",
                  borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 700,
                }}
              >
                <Settings size={14} /> Adicionar categorias e atividades
              </Link>
            )}
          </div>
        ) : (
          Object.entries(groups).map(([category, items]) => {
            const catColor = getCategoryColor(category);
            const stats = getCategoryStats(items);
            return (
              <div key={category} style={{ marginBottom: 20 }}>
                {/* Category Header */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 8, paddingBottom: 8,
                  borderBottom: `2px solid ${catColor}30`
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 3, height: 18, background: catColor, borderRadius: 2 }} />
                    <span style={{ color: "#E8EAF0", fontWeight: 600, fontSize: 14 }}>{category}</span>
                    <span style={{ color: "#E8EAF0", fontSize: 12 }}>({items.length})</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "#34D399", fontSize: 12 }}>{stats.done}/{stats.total}</span>
                    <div style={{ width: 60, height: 4, background: "#1E2333", borderRadius: 2 }}>
                      <div style={{
                        width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%`,
                        height: "100%", background: catColor, borderRadius: 2, transition: "width 0.3s"
                      }} />
                    </div>
                  </div>
                </div>

                {/* Activity Rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {items.map((activity) => {
                    const st = getStatusStyle(activity.status);
                    const isSavingThis = saving === activity.id;
                    return (
                      <div
                        key={activity.id}
                        style={{
                          background: "#181C27", border: "1px solid #2A3045",
                          borderRadius: 8, padding: "12px 16px",
                          transition: "border-color 0.15s",
                          borderLeft: `3px solid ${st.border}`
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          {/* Activity text */}
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <p style={{ color: "#E8EAF0", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                              {activity.activity}
                            </p>
                            {(observationsByActivity[activity.id] || []).map((note) => (
                              <div key={note.id} style={{
                                background: "#1E2333", border: "1px solid #2A3045", borderRadius: 8,
                                padding: "8px 10px", marginTop: 6
                              }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                  <p style={{
                                    color: "#E8EAF0", fontSize: 12, margin: 0, flex: 1, minWidth: 0,
                                    whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5
                                  }}>
                                    {note.text}
                                  </p>
                                  {/* Só o autor edita/apaga (regra em lib/ownership.ts, aplicada também na API). */}
                                  {isOwner(note.user_id, user.id) && (
                                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                                    <button
                                      onClick={() => {
                                        setActiveActivityId(activity.id);
                                        setEditingNoteId(note.id);
                                        setObsValue(note.text);
                                      }}
                                      title="Editar observação"
                                      style={{
                                        background: "transparent", border: "none", borderRadius: 4,
                                        padding: "4px", cursor: "pointer", display: "flex",
                                        color: "#60A5FA", transition: "color 0.15s"
                                      }}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      onClick={() => deleteObs(note.id)}
                                      title="Apagar observação"
                                      style={{
                                        background: "transparent", border: "none", borderRadius: 4,
                                        padding: "4px", cursor: "pointer", display: "flex",
                                        color: "#F87171", transition: "color 0.15s"
                                      }}
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, color: "#E8EAF0", fontSize: 10, opacity: 0.7 }}>
                                  <MessageSquare size={10} />
                                  <span>{note.user_name || "—"} · {formatNoteDate(note.created_at)}</span>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Controls */}
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                            {/* Status Select */}
                            <div style={{ position: "relative" }}>
                              <select
                                value={activity.status}
                                onChange={(e) => updateActivity(activity.id, { status: e.target.value })}
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

                            {/* Obs button */}
                            <button
                              onClick={() => {
                                setActiveActivityId(activity.id);
                                setEditingNoteId(null);
                                setObsValue("");
                              }}
                              title="Nova observação"
                              style={{
                                background: "transparent", border: "1px solid #2A3045",
                                borderRadius: 6, padding: "5px 8px", cursor: "pointer", display: "flex",
                                color: (observationsByActivity[activity.id] || []).length > 0 ? "#60A5FA" : "#E8EAF0"
                              }}
                            >
                              <MessageSquare size={14} />
                            </button>

                            {/* Saving indicator */}
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
      </main>

      {/* Observation Modal */}
      {(activeActivityId !== null) && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 20
          }}
          onClick={(e) => { if (e.target === e.currentTarget) {
            setActiveActivityId(null);
            setEditingNoteId(null);
          } }}
        >
          <div style={{
            background: "#1E2333", border: "1px solid #2A3045",
            borderRadius: 12, padding: 24, width: "100%", maxWidth: 480
          }}>
            <h3 style={{ color: "#E8EAF0", fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>
              {editingNoteId ? "Editar observação" : "Nova observação"}
            </h3>
            <textarea
              value={obsValue}
              onChange={(e) => setObsValue(e.target.value)}
              placeholder="Adicione uma observação sobre esta atividade..."
              autoFocus
              rows={4}
              style={{
                width: "100%", background: "#181C27", border: "1px solid #2A3045",
                borderRadius: 8, padding: "10px 12px", color: "#E8EAF0",
                fontSize: 13, outline: "none", resize: "vertical",
                fontFamily: "Inter, system-ui, sans-serif"
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                onClick={() => {
                  setActiveActivityId(null);
                  setEditingNoteId(null);
                }}
                style={{
                  background: "transparent", border: "none",
                  padding: "8px", color: "#E8EAF0",
                  fontSize: 13, cursor: "pointer"
                }}
              >
                Cancelar
              </button>
              {editingNoteId && (
                <button
                  onClick={() => {
                    deleteObs(editingNoteId);
                  }}
                  style={{
                    background: "transparent", border: "none",
                    padding: "8px", color: "#F87171",
                    fontSize: 13, cursor: "pointer"
                  }}
                >
                  Apagar
                </button>
              )}
              <button
                onClick={saveObs}
                style={{
                  background: "#3B6EF5", border: "none",
                  borderRadius: 8, padding: "8px 20px", color: "white",
                  fontSize: 13, fontWeight: 600, cursor: "pointer"
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
      <ChecklistPage />
    </Suspense>
  );
}
