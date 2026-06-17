"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

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

const STATUS_LABEL: Record<string, string> = {
  SEM_STATUS: "Sem Status",
  NAO_INICIADO: "Não Iniciado",
  EM_ANDAMENTO: "Em Andamento",
  CONCLUIDO: "Concluído",
  IMPEDIDO: "Impedido",
};

const STATUS_COLOR: Record<string, string> = {
  SEM_STATUS: "#7A82A0",
  NAO_INICIADO: "#b10202",
  EM_ANDAMENTO: "#ffe5a0",
  CONCLUIDO: "#11734b",
  IMPEDIDO: "#b10202",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function HistoryPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("sasi-token") || searchParams.get("token") || "";

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const isLocalDev =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

  const fetchHistory = useCallback(async () => {
    if (!token && !isLocalDev) { setAuthError(true); setLoading(false); return; }
    try {
      const query = token ? `?sasi-token=${encodeURIComponent(token)}` : "";
      const res = await fetch(`/api/history${query}`);
      if (!res.ok) { setAuthError(true); setLoading(false); return; }
      const data = await res.json();
      setHistory(data.history);
      setUser(data.user);
    } catch {
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token, isLocalDev]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const filtered = history.filter((h) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      h.activity?.toLowerCase().includes(s) ||
      h.user_name?.toLowerCase().includes(s) ||
      h.category?.toLowerCase().includes(s)
    );
  });

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
          <p style={{ color: "#7A82A0", fontSize: 14 }}>Carregando histórico...</p>
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
          <h2 style={{ color: "#F87171", fontSize: 20, fontWeight: 600 }}>Acesso negado</h2>
          <p style={{ color: "#7A82A0", fontSize: 14 }}>Token inválido ou não informado.</p>
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
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href={isLocalDev ? "/" : `/?sasi-token=${encodeURIComponent(token)}`}
              style={{
                color: "#7A82A0", textDecoration: "none", fontSize: 13,
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", borderRadius: 6, border: "1px solid #2A3045"
              }}
            >
              ← Checklist
            </Link>
            <div style={{ width: 1, height: 20, background: "#2A3045" }} />
            <span style={{ color: "#E8EAF0", fontWeight: 600, fontSize: 15 }}>Histórico de Alterações</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#1E2333", borderRadius: 6, border: "1px solid #2A3045" }}>
            <div style={{ width: 24, height: 24, background: "#3B6EF5", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "white" }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ color: "#E8EAF0", fontSize: 13 }}>{user.name}</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px" }}>
        {/* Stats */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ color: "#3B6EF5", fontSize: 28, fontWeight: 700 }}>{history.length}</div>
            <div style={{ color: "#4A5270", fontSize: 12, marginTop: 4 }}>Total de alterações</div>
          </div>
          <div style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ color: "#34D399", fontSize: 28, fontWeight: 700 }}>
              {history.filter((h) => h.new_status === "CONCLUIDO").length}
            </div>
            <div style={{ color: "#4A5270", fontSize: 12, marginTop: 4 }}>Marcadas concluídas</div>
          </div>
          <div style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 10, padding: "16px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ color: "#A78BFA", fontSize: 28, fontWeight: 700 }}>
              {new Set(history.map((h) => h.user_id)).size}
            </div>
            <div style={{ color: "#4A5270", fontSize: 12, marginTop: 4 }}>Usuários ativos</div>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Buscar no histórico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%", background: "#181C27", border: "1px solid #2A3045",
              borderRadius: 8, padding: "10px 12px 10px 38px", color: "#E8EAF0",
              fontSize: 13, outline: "none"
            }}
          />
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#4A5270" }}>🔍</span>
        </div>

        {/* History List */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 24px", background: "#181C27", borderRadius: 12, border: "1px solid #2A3045" }}>
            <p style={{ color: "#4A5270", fontSize: 15, margin: 0 }}>
              {history.length === 0 ? "Nenhuma alteração registrada ainda." : "Nenhum resultado encontrado."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: "#181C27", border: "1px solid #2A3045",
                  borderRadius: 10, padding: "16px 20px",
                  borderLeft: `3px solid ${STATUS_COLOR[entry.new_status] || "#2A3045"}`
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    {/* Category tag */}
                    <div style={{ marginBottom: 6 }}>
                      <span style={{
                        fontSize: 10, color: "#4A5270", background: "#1E2333",
                        border: "1px solid #2A3045", borderRadius: 4, padding: "2px 8px",
                        fontWeight: 500, letterSpacing: 0.3
                      }}>
                        {entry.category || "—"}
                      </span>
                    </div>

                    {/* Activity */}
                    <p style={{ color: "#C8CAD6", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
                      {entry.activity || `Atividade ${entry.activity_id.slice(0, 8)}...`}
                    </p>

                    {/* Status transition */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 10px",
                        borderRadius: 20, border: `1px solid ${STATUS_COLOR[entry.old_status] || "#2A3045"}`,
                        color: STATUS_COLOR[entry.old_status] || "#7A82A0",
                        background: `${STATUS_COLOR[entry.old_status] || "#2A3045"}15`
                      }}>
                        {STATUS_LABEL[entry.old_status] || entry.old_status || "—"}
                      </span>
                      <span style={{ color: "#4A5270", fontSize: 12 }}>→</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 10px",
                        borderRadius: 20, border: `1px solid ${STATUS_COLOR[entry.new_status] || "#2A3045"}`,
                        color: STATUS_COLOR[entry.new_status] || "#7A82A0",
                        background: `${STATUS_COLOR[entry.new_status] || "#2A3045"}15`
                      }}>
                        {STATUS_LABEL[entry.new_status] || entry.new_status || "—"}
                      </span>
                    </div>

                    {entry.observation && (
                      <p style={{ color: "#4A5270", fontSize: 12, margin: "8px 0 0", fontStyle: "italic" }}>
                        💬 {entry.observation}
                      </p>
                    )}
                  </div>

                  {/* Meta */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500 }}>{entry.user_name}</div>
                    <div style={{ color: "#4A5270", fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                      {formatDate(entry.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
