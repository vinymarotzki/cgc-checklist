"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

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

const STATUS_OPTIONS = [
  { value: "SEM_STATUS", label: "Sem Status", color: "#7A82A0" },
  { value: "NAO_INICIADO", label: "Não Iniciado", color: "#A78BFA" },
  { value: "EM_ANDAMENTO", label: "Em Andamento", color: "#60A5FA" },
  { value: "CONCLUIDO", label: "Concluído", color: "#34D399" },
  { value: "IMPEDIDO", label: "Impedido", color: "#F87171" },
];

function getStatusStyle(status: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    SEM_STATUS: { bg: "#1E2333", text: "#7A82A0", border: "#2A3045" },
    NAO_INICIADO: { bg: "#1E1A2A", text: "#A78BFA", border: "#7C3AED" },
    EM_ANDAMENTO: { bg: "#1A2E4A", text: "#60A5FA", border: "#2563EB" },
    CONCLUIDO: { bg: "#0F2A1E", text: "#34D399", border: "#059669" },
    IMPEDIDO: { bg: "#2A1A1A", text: "#F87171", border: "#DC2626" },
  };
  return map[status] ?? map["SEM_STATUS"];
}

function getCategoryColor(category: string) {
  const colors = [
    "#3B6EF5", "#8B5CF6", "#06B6D4", "#F59E0B",
    "#10B981", "#EF4444", "#EC4899", "#6366F1",
  ];
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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
  const token = searchParams.get("sasi-token") || searchParams.get("token") || "";

  const [activities, setActivities] = useState<Activity[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingObs, setEditingObs] = useState<string | null>(null);
  const [obsValue, setObsValue] = useState("");
  const [filter, setFilter] = useState("TODOS");
  const [searchTerm, setSearchTerm] = useState("");
  const isLocalDev =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

  const fetchActivities = useCallback(async () => {
    if (!token && !isLocalDev) {
      setAuthError(true);
      setLoading(false);
      return;
    }
    try {
      const query = token ? `?sasi-token=${encodeURIComponent(token)}` : "";
      const res = await fetch(`/api/activities${query}`);
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
  }, [token, isLocalDev]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  async function updateActivity(id: string, patch: Partial<Activity>) {
    setSaving(id);
    try {
      const query = token ? `?sasi-token=${encodeURIComponent(token)}` : "";
      await fetch(`/api/activities${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      setActivities((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
    } finally {
      setSaving(null);
    }
  }

  function saveObs(id: string) {
    updateActivity(id, { observation: obsValue });
    setEditingObs(null);
  }

  const totalStats = getCategoryStats(activities);
  const completionPct = totalStats.total > 0
    ? Math.round((totalStats.done / totalStats.total) * 100)
    : 0;

  const filteredActivities = activities.filter((a) => {
    const matchFilter = filter === "TODOS" || a.status === filter;
    const matchSearch = !searchTerm ||
      a.activity.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchFilter && matchSearch;
  });

  const groups = groupByCategory(filteredActivities);

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
            Token inválido ou não informado. Acesse o sistema através do link fornecido pelo SASI.
          </p>
          {!token && (
            <p style={{ color: "#4A5270", fontSize: 12, marginTop: 12, fontFamily: "monospace" }}>
              URL esperada: /?sasi-token=SEU_TOKEN
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh" }}>
      {/* Header */}
      <header style={{
        background: "#181C27", borderBottom: "1px solid #2A3045",
        padding: "0 24px", position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link
              href={isLocalDev ? "/history" : `/history?sasi-token=${encodeURIComponent(token)}`}
              style={{
                color: "#7A82A0", fontSize: 13, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 6, border: "1px solid #2A3045",
                transition: "all 0.15s"
              }}
            >
              📋 Histórico
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

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {/* Progress Overview */}
        <div style={{
          background: "#181C27", border: "1px solid #2A3045",
          borderRadius: 12, padding: 24, marginBottom: 24
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h1 style={{ color: "#E8EAF0", fontSize: 22, fontWeight: 700, margin: 0 }}>
                Simulado de Evacuação
              </h1>
              <p style={{ color: "#7A82A0", fontSize: 13, marginTop: 4 }}>
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
                  <div style={{ color: "#4A5270", fontSize: 11, marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#7A82A0", fontSize: 12 }}>Progresso geral</span>
              <span style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600 }}>{completionPct}%</span>
            </div>
            <div style={{ background: "#1E2333", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${completionPct}%`,
                background: "linear-gradient(90deg, #3B6EF5, #34D399)",
                borderRadius: 4, transition: "width 0.5s ease"
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
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#4A5270", fontSize: 14 }}>🔍</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["TODOS", "SEM_STATUS", "NAO_INICIADO", "EM_ANDAMENTO", "CONCLUIDO", "IMPEDIDO"].map((f) => {
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
            <p style={{ color: "#7A82A0", fontSize: 15 }}>Nenhuma atividade encontrada</p>
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
                    <span style={{ color: "#4A5270", fontSize: 12 }}>({items.length})</span>
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
                            <p style={{ color: "#C8CAD6", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                              {activity.activity}
                            </p>
                            {activity.observation && (
                              <p style={{ color: "#4A5270", fontSize: 12, margin: "4px 0 0", fontStyle: "italic" }}>
                                💬 {activity.observation}
                              </p>
                            )}
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
                                setEditingObs(activity.id);
                                setObsValue(activity.observation || "");
                              }}
                              title="Editar observação"
                              style={{
                                background: "transparent", border: "1px solid #2A3045",
                                borderRadius: 6, padding: "5px 8px", cursor: "pointer",
                                color: activity.observation ? "#60A5FA" : "#4A5270",
                                fontSize: 13, transition: "all 0.15s"
                              }}
                            >
                              💬
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
      {editingObs && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 20
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingObs(null); }}
        >
          <div style={{
            background: "#1E2333", border: "1px solid #2A3045",
            borderRadius: 12, padding: 24, width: "100%", maxWidth: 480
          }}>
            <h3 style={{ color: "#E8EAF0", fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>
              Observação
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
                onClick={() => setEditingObs(null)}
                style={{
                  background: "transparent", border: "1px solid #2A3045",
                  borderRadius: 8, padding: "8px 16px", color: "#7A82A0",
                  fontSize: 13, cursor: "pointer"
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => saveObs(editingObs)}
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
