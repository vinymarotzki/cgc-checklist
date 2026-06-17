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

interface CompletedChecklistEntry {
  id: string;
  user_id: string;
  user_name: string;
  total_items: number;
  completed_items: number;
  completed_at: string;
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

function escapeCsv(value: string | number | null | undefined) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

function exportHistoryCsv(history: HistoryEntry[], completedChecklists: CompletedChecklistEntry[]) {
  const rows: string[][] = [
    ["Tipo", "ID", "Atividade", "Categoria", "Status Antigo", "Status Novo", "Usuário", "Observação", "Data/Hora"]
  ];

  history.forEach((entry) => {
    rows.push([
      "Alteração",
      entry.id,
      entry.activity || "",
      entry.category || "",
      entry.old_status,
      entry.new_status,
      entry.user_name,
      entry.observation || "",
      entry.created_at,
    ]);
  });

  if (completedChecklists.length > 0) {
    rows.push([""], ["Finalização de checklist", "ID", "Usuário", "Total de Itens", "Itens Concluídos", "Data/Hora"]);
    completedChecklists.forEach((entry) => {
      rows.push([
        "Finalização",
        entry.id,
        entry.user_name,
        String(entry.total_items),
        String(entry.completed_items),
        entry.completed_at,
      ]);
    });
  }

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `historico-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function HistoryPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("sasi-token") || searchParams.get("token") || "";

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [completedChecklists, setCompletedChecklists] = useState<CompletedChecklistEntry[]>([]);
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
      setCompletedChecklists(data.completed || []);
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
    <div className="page-shell">
      <header className="history-header">
        <div className="history-header-inner">
          <div className="history-header-left">
            <Link
              href={isLocalDev ? "/" : `/?sasi-token=${encodeURIComponent(token)}`}
              className="history-back-link"
            >
              ← Checklist
            </Link>
          </div>
          <div className="history-header-main">
            <span className="history-page-title">Histórico de Alterações</span>
            <span className="history-user-badge">
              <span>{user.name.charAt(0).toUpperCase()}</span>
              <span>{user.name}</span>
            </span>
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
          <div className="history-stat-card">
            <div className="history-stat-value">{completedChecklists.length}</div>
            <div className="history-stat-label">Finalizações de checklist</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{new Set(completedChecklists.map((c) => c.user_id)).size}</div>
            <div className="history-stat-label">Finalizadores únicos</div>
          </div>
        </div>

        <div className="history-actions-row">
          <button
            type="button"
            className="history-export-button"
            onClick={() => exportHistoryCsv(history, completedChecklists)}
          >
            Exportar CSV
          </button>
        </div>

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

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Finalizações de checklist</h2>
          </div>
          {completedChecklists.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhuma finalização de checklist registrada ainda.</p>
            </div>
          ) : (
            <div className="history-completions-list">
              {completedChecklists.map((entry) => (
                <div key={entry.id} className="history-completion-card">
                  <div>
                    <div className="history-completion-user">{entry.user_name}</div>
                    <div className="history-completion-meta">{entry.total_items} itens concluídos em {formatDate(entry.completed_at)}</div>
                  </div>
                  <div className="history-completion-count">{entry.completed_items}/{entry.total_items}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {filtered.length === 0 ? (
          <div className="history-empty-state">
            <p>
              {history.length === 0 ? "Nenhuma alteração registrada ainda." : "Nenhum resultado encontrado."}
            </p>
          </div>
        ) : (
          <div className="history-list">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="history-card"
                style={{ borderLeftColor: STATUS_COLOR[entry.new_status] || "#2A3045" }}
              >
                <div className="history-card-content">
                  <div className="history-card-main">
                    <div className="history-category-tag">
                      <span className="history-category-badge">
                        {entry.category || "—"}
                      </span>
                    </div>

                    <p className="history-activity">
                      {entry.activity || `Atividade ${entry.activity_id.slice(0, 8)}...`}
                    </p>

                    <div className="history-status-row">
                      <span className="history-status-pill" style={{
                        border: `1px solid ${STATUS_COLOR[entry.old_status] || "#2A3045"}`,
                        color: STATUS_COLOR[entry.old_status] || "#7A82A0",
                        background: `${STATUS_COLOR[entry.old_status] || "#2A3045"}15`
                      }}>
                        {STATUS_LABEL[entry.old_status] || entry.old_status || "—"}
                      </span>
                      <span style={{ color: "#4A5270", fontSize: 12 }}>→</span>
                      <span className="history-status-pill" style={{
                        border: `1px solid ${STATUS_COLOR[entry.new_status] || "#2A3045"}`,
                        color: STATUS_COLOR[entry.new_status] || "#7A82A0",
                        background: `${STATUS_COLOR[entry.new_status] || "#2A3045"}15`
                      }}>
                        {STATUS_LABEL[entry.new_status] || entry.new_status || "—"}
                      </span>
                    </div>

                    {entry.observation && (
                      <p className="history-observation">
                        💬 {entry.observation}
                      </p>
                    )}
                  </div>

                  <div className="history-card-meta">
                    <div className="meta-name">{entry.user_name}</div>
                    <div className="meta-date">{formatDate(entry.created_at)}</div>
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
