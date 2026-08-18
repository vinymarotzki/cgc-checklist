"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { sasiAuthHeaders } from "@/lib/token";
import { useSasiToken } from "@/hooks/useSasiToken";
import { getStatusColor } from "@/lib/checklist-status";
import * as XLSX from "xlsx";
import { Lock, RefreshCw, Plus, ExternalLink, Pencil, Trash2, Upload, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChecklistSummary {
  id: string;
  title: string;
  created_by_name: string | null;
  created_at: string;
  activity_count: number;
  completed_count: number;
  progress: number;
}

interface User {
  id: string;
  name: string;
}

type ImportField = 'category' | 'activity' | 'status' | 'responsible' | 'observation';

interface ParsedActivity {
  category: string;
  activity: string;
  status?: string;
  responsible?: string;
  observation?: string;
}

const importFieldLabels: Record<ImportField, string> = {
  category: 'Categoria',
  activity: 'Atividade',
  status: 'Status',
  responsible: 'Responsável',
  observation: 'Observação',
};

const statusHeaders = new Set(['status', 'estado', 'situação', 'situacao']);
const responsibleHeaders = new Set(['responsável', 'responsavel', 'responsible', 'owner', 'responsavel']);
const observationHeaders = new Set(['observacao', 'observação', 'note', 'nota', 'obs']);

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Cor da barra de progresso por faixa, reaproveitando a paleta de status do checklist. */
function progressColor(pct: number) {
  if (pct >= 70) return getStatusColor("CONCLUIDO");
  if (pct >= 34) return getStatusColor("EM_ANDAMENTO");
  return getStatusColor("NAO_INICIADO");
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const categoryHeaders = new Set(["categoria", "category", "cat", "categorias"]);
const activityHeaders = new Set(["atividade", "activity", "tarefa", "task", "atividades"]);

function findHeaderRow(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const normalized = row.map(normalizeHeader);
    const categoryIndex = normalized.findIndex((value) => categoryHeaders.has(value));
    const activityIndex = normalized.findIndex((value) => activityHeaders.has(value));

    if (categoryIndex !== -1 && activityIndex !== -1) {
      return { rowIndex, categoryIndex, activityIndex };
    }
  }
  return null;
}

function findHeaderIndex(labels: string[], headerSet: Set<string>) {
  return labels.findIndex((label) => headerSet.has(normalizeHeader(label)));
}

function getColumnLabel(value: unknown, index: number) {
  const text = String(value || "").trim();
  if (text) return text;
  const letter = String.fromCharCode(65 + (index % 26));
  return `Coluna ${letter}`;
}

function buildParsedActivities(
  rows: unknown[][],
  mapping: Record<ImportField, number | null>,
  skipRows = 0
) {
  const { category, activity } = mapping;
  if (category === null || activity === null) {
    return [];
  }

  return rows
    .slice(skipRows)
    .map((row) => {
      const categoryValue = String(row[category] || "").trim();
      const activityValue = String(row[activity] || "").trim();
      const item: ParsedActivity = { category: categoryValue, activity: activityValue };

      if (mapping.status !== null) {
        const statusValue = String(row[mapping.status] || "").trim();
        item.status = statusValue || undefined;
      }
      if (mapping.responsible !== null) {
        const responsibleValue = String(row[mapping.responsible] || "").trim();
        item.responsible = responsibleValue || undefined;
      }
      if (mapping.observation !== null) {
        const observationValue = String(row[mapping.observation] || "").trim();
        item.observation = observationValue || undefined;
      }

      return item;
    })
    .filter((item) => item.category && item.activity);
}

function parseCsvRows(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const commaCount = (lines[0].match(/,/g) || []).length;
  const semicolonCount = (lines[0].match(/;/g) || []).length;
  const tabCount = (lines[0].match(/\t/g) || []).length;
  const delimiter = tabCount >= semicolonCount && tabCount >= commaCount ? "\t" : semicolonCount > commaCount ? ";" : ",";

  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function ChecklistsPage() {
  const token = useSasiToken();

  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [title, setTitle] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingChecklistTitle, setEditingChecklistTitle] = useState("");
  const [parsedActivities, setParsedActivities] = useState<ParsedActivity[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState<number | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [selectedCategoryColumn, setSelectedCategoryColumn] = useState<number | null>(null);
  const [selectedActivityColumn, setSelectedActivityColumn] = useState<number | null>(null);
  const [selectedStatusColumn, setSelectedStatusColumn] = useState<number | null>(null);
  const [selectedResponsibleColumn, setSelectedResponsibleColumn] = useState<number | null>(null);
  const [selectedObservationColumn, setSelectedObservationColumn] = useState<number | null>(null);

  const listHref = "/checklists";

  const fetchChecklists = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/checklists", { headers: sasiAuthHeaders(token) });
      if (!res.ok) {
        setAuthError(true);
        return;
      }
      const data = await res.json();
      setChecklists(data.checklists || []);
      setUser(data.user);
    } catch {
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  async function handleFile(file: File | null) {
    setParseError(null);
    setParsedActivities([]);
    setRawRows([]);
    setHeaderRowIndex(null);
    setDetectedColumns([]);
    setSelectedCategoryColumn(null);
    setSelectedActivityColumn(null);
    setSelectedStatusColumn(null);
    setSelectedResponsibleColumn(null);
    setSelectedObservationColumn(null);
    if (!file) return;

    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setParseError("Formato não suportado. Envie um arquivo .csv ou .xlsx.");
      return;
    }

    try {
      let rows: unknown[][] = [];
      const buffer = await file.arrayBuffer();

      try {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      } catch {
        // Fall back to CSV/TSV/text parsing if workbook parsing fails
      }

      if (!rows.length) {
        const text = await file.text();
        rows = parseCsvRows(text);
      }

      if (rows.length === 0) {
        throw new Error("Não foi possível ler o arquivo de importação.");
      }

      const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const foundHeader = findHeaderRow(rows);
      const firstDataRowIndex = foundHeader ? foundHeader.rowIndex + 1 : 0;
      const headerLabels = Array.from({ length: maxColumns }, (_, idx) =>
        getColumnLabel(foundHeader ? rows[foundHeader.rowIndex][idx] : rows[0][idx], idx)
      );

      const categoryIndex = foundHeader ? foundHeader.categoryIndex : 0;
      const activityIndex = foundHeader ? foundHeader.activityIndex : Math.min(1, maxColumns - 1);
      const statusIndex = foundHeader ? findHeaderIndex(headerLabels, statusHeaders) : null;
      const responsibleIndex = foundHeader ? findHeaderIndex(headerLabels, responsibleHeaders) : null;
      const observationIndex = foundHeader ? findHeaderIndex(headerLabels, observationHeaders) : null;

      setRawRows(rows);
      setHeaderRowIndex(foundHeader ? foundHeader.rowIndex : null);
      setDetectedColumns(headerLabels);
      setSelectedCategoryColumn(categoryIndex);
      setSelectedActivityColumn(activityIndex);
      setSelectedStatusColumn(statusIndex);
      setSelectedResponsibleColumn(responsibleIndex);
      setSelectedObservationColumn(observationIndex);
      setParsedActivities(
        buildParsedActivities(rows, {
          category: categoryIndex,
          activity: activityIndex,
          status: statusIndex,
          responsible: responsibleIndex,
          observation: observationIndex,
        }, firstDataRowIndex)
      );
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Falha ao ler a planilha.");
    }
  }

  async function createChecklist() {
    if (!title.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ title: title.trim(), activities: parsedActivities }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Falha ao criar checklist.");
      }

      setModalOpen(false);
      setTitle("");
      setParsedActivities([]);
      setParseError(null);
      await fetchChecklists();
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Erro inesperado ao criar checklist.");
    } finally {
      setSaving(false);
    }
  }

  async function updateChecklist() {
    if (!editingChecklistId || !editingChecklistTitle.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/checklists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id: editingChecklistId, title: editingChecklistTitle.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Falha ao atualizar checklist.");
      }

      setModalOpen(false);
      setEditingChecklistId(null);
      setEditingChecklistTitle("");
      setParseError(null);
      await fetchChecklists();
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Erro inesperado ao atualizar checklist.");
    } finally {
      setSaving(false);
    }
  }

  function openCreateModal() {
    setEditorMode('create');
    setTitle("");
    setEditingChecklistId(null);
    setEditingChecklistTitle("");
    setParsedActivities([]);
    setParseError(null);
    setModalOpen(true);
  }

  function openEditModal(checklist: ChecklistSummary) {
    setEditorMode('edit');
    setEditingChecklistId(checklist.id);
    setEditingChecklistTitle(checklist.title);
    setTitle("");
    setParsedActivities([]);
    setParseError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingChecklistId(null);
    setEditingChecklistTitle("");
    setTitle("");
    setParsedActivities([]);
    setParseError(null);
  }

  async function deleteChecklist(id: string) {
    if (!confirm("Excluir este checklist e todas as atividades vinculadas?")) return;

    setDeletingId(id);
    try {
      const res = await fetch("/api/checklists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setChecklists((prev) => prev.filter((item) => item.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", color: "#E8EAF0" }}>
        Carregando checklists...
      </div>
    );
  }

  const totalActivities = checklists.reduce((sum, c) => sum + c.activity_count, 0);
  const totalCompleted = checklists.reduce((sum, c) => sum + c.completed_count, 0);
  const avgProgress = checklists.length > 0
    ? Math.round(checklists.reduce((sum, c) => sum + c.progress, 0) / checklists.length)
    : 0;

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

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh", color: "#E8EAF0" }}>
      <header className="app-header">
        <div className="app-header-inner">
          <div style={{ flex: "0 0 auto" }}>
            <h1 style={{ margin: 0, fontSize: 20, whiteSpace: "nowrap" }}>Checklists</h1>
          </div>
          <div className="app-nav">
            <Link href={listHref} style={{ color: "#E8EAF0", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <RefreshCw size={14} /> Atualizar
            </Link>
            <button
              onClick={openCreateModal}
              style={{ background: "#3B6EF5", color: "white", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            >
              <Plus size={16} /> <span className="btn-label-desktop">Checklist</span>
            </button>
            <span style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#1E2333", border: "1px solid #2A3045", borderRadius: 8,
              padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap", flexShrink: 0
            }}>
              <User size={14} color="#E8EAF0" /> {user.name.split(" ")[0]}
            </span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {checklists.length > 0 && (
          <div style={{
            background: "#181C27", border: "1px solid #2A3045", borderLeft: "4px solid #3B6EF5",
            borderRadius: 12, padding: 16, marginBottom: 16,
            display: "flex", gap: 8, flexWrap: "wrap"
          }}>
            {[
              { label: "Checklists", value: checklists.length, color: "#60A5FA" },
              { label: "Atividades", value: totalActivities, color: "#E8EAF0" },
              { label: "Concluídas", value: totalCompleted, color: "#34D399" },
              { label: "Progresso médio", value: `${avgProgress}%`, color: progressColor(avgProgress) },
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: "1 1 140px", background: "#1E2333", border: "1px solid #2A3045",
                borderRadius: 10, padding: "10px 14px"
              }}>
                <div style={{ color: stat.color, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ color: "#E8EAF0", fontSize: 11, marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {checklists.length === 0 ? (
          <div style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 12, padding: 40, textAlign: "center" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Nenhum checklist cadastrado</h2>
            <p style={{ margin: 0, color: "#E8EAF0", fontSize: 14 }}>Crie um checklist vazio ou importe uma planilha CSV/XLSX.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {checklists.map((checklist) => (
              <div
                key={checklist.id}
                className="split-card"
                style={{
                  background: "#181C27", border: "1px solid #2A3045",
                  borderLeft: `3px solid ${progressColor(checklist.progress)}`,
                  borderRadius: 10, padding: 12
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700 }}>{checklist.title}</h2>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ background: "#1E2333", border: "1px solid #2A3045", borderRadius: 999, padding: "3px 10px", color: "#E8EAF0", fontSize: 12 }}>
                      {formatDate(checklist.created_at)}
                    </span>
                    <span style={{ background: "#1E2333", border: "1px solid #2A3045", borderRadius: 999, padding: "3px 10px", color: "#E8EAF0", fontSize: 12 }}>
                      {checklist.created_by_name || "Sem autor"}
                    </span>
                    <span style={{ background: "#1E2333", border: "1px solid #2A3045", borderRadius: 999, padding: "3px 10px", color: "#E8EAF0", fontSize: 12 }}>
                      {checklist.completed_count}/{checklist.activity_count} atividades
                    </span>
                  </div>
                  <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ height: 8, background: "#1E2333", borderRadius: 999, overflow: "hidden", width: 220, maxWidth: "100%" }}>
                      <div style={{ width: `${checklist.progress}%`, height: "100%", background: progressColor(checklist.progress), borderRadius: 999, transition: "width 0.4s ease" }} />
                    </div>
                    <span style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 700 }}>{checklist.progress}%</span>
                  </div>
                </div>
                <div className="card-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    style={{ background: "#1E2333", borderColor: "#3B6EF5", color: "#E8EAF0" }}
                    aria-label="Abrir checklist"
                    title="Abrir checklist"
                    render={<Link href={`/?checklist=${encodeURIComponent(checklist.id)}`} />}
                  >
                    <ExternalLink /> <span className="btn-label-desktop">Abrir</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    style={{ background: "#1E2333", borderColor: "#2A3045", color: "#E8EAF0" }}
                    aria-label="Editar checklist"
                    title="Editar checklist"
                    onClick={() => openEditModal(checklist)}
                  >
                    <Pencil /> <span className="btn-label-desktop">Editar</span>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    style={{ background: "transparent", borderColor: "#3A2430", color: "#F87171" }}
                    aria-label={deletingId === checklist.id ? "Excluindo..." : "Excluir checklist"}
                    title={deletingId === checklist.id ? "Excluindo..." : "Excluir checklist"}
                    disabled={deletingId === checklist.id}
                    onClick={() => deleteChecklist(checklist.id)}
                  >
                    <Trash2 />
                    <span className="btn-label-desktop">
                      {deletingId === checklist.id ? "Excluindo..." : "Excluir"}
                    </span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {modalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center", padding: 20, zIndex: 1000 }} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={{ background: "#1E2333", border: "1px solid #2A3045", borderRadius: 12, padding: 24, width: "100%", maxWidth: 760, maxHeight: "90vh", overflow: "auto" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{editorMode === 'edit' ? 'Editar checklist' : 'Novo checklist'}</h2>
            <p style={{ margin: "0 0 18px", color: "#E8EAF0", fontSize: 13 }}>
              {editorMode === 'edit' ? 'Altere o título deste checklist.' : 'Crie um checklist vazio ou importe as atividades de uma planilha.'}
            </p>
            <label style={{ color: "#E8EAF0", fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
              Título
              <input
                value={editorMode === 'edit' ? editingChecklistTitle : title}
                onChange={(e) => (editorMode === 'edit' ? setEditingChecklistTitle(e.target.value) : setTitle(e.target.value))}
                placeholder="Ex.: Checklist de abandono de área"
                style={{ width: "100%", background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0", outline: "none" }}
              />
            </label>

            {editorMode === 'create' && (
              <div style={{ marginTop: 18, background: "#181C27", border: "1px solid #2A3045", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <Upload size={14} /> Importar planilha
                    </strong>
                    <p style={{ margin: "4px 0 0", color: "#E8EAF0", fontSize: 13 }}>Selecione quais colunas devem ser importadas. Use &quot;Não importar&quot; para ignorar colunas opcionais.</p>
                  </div>
                  <input type="file" accept=".csv,.xlsx" onChange={(e) => handleFile(e.target.files?.[0] || null)} style={{ color: "#E8EAF0", fontSize: 13 }} />
                </div>

                {parseError && <p style={{ color: "#F87171", fontSize: 13, margin: "12px 0 0" }}>{parseError}</p>}

                {rawRows.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ color: "#34D399", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                      {parsedActivities.length} atividades detectadas
                    </div>

                    {detectedColumns.length > 0 && (
                      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                        <div className="two-col">
                          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#E8EAF0" }}>
                            Coluna Categoria
                            <select
                              value={selectedCategoryColumn ?? 0}
                              onChange={(e) => {
                                const nextCategoryIndex = Number(e.target.value);
                                setSelectedCategoryColumn(nextCategoryIndex);
                                setParsedActivities(buildParsedActivities(rawRows, {
                                  category: nextCategoryIndex,
                                  activity: selectedActivityColumn,
                                  status: selectedStatusColumn,
                                  responsible: selectedResponsibleColumn,
                                  observation: selectedObservationColumn,
                                }, headerRowIndex !== null ? headerRowIndex + 1 : 0));
                              }}
                              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0" }}
                            >
                              {detectedColumns.map((column, idx) => (
                                <option key={idx} value={idx}>{column}</option>
                              ))}
                            </select>
                          </label>

                          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#E8EAF0" }}>
                            Coluna Atividade
                            <select
                              value={selectedActivityColumn ?? 1}
                              onChange={(e) => {
                                const nextActivityIndex = Number(e.target.value);
                                setSelectedActivityColumn(nextActivityIndex);
                                setParsedActivities(buildParsedActivities(rawRows, {
                                  category: selectedCategoryColumn,
                                  activity: nextActivityIndex,
                                  status: selectedStatusColumn,
                                  responsible: selectedResponsibleColumn,
                                  observation: selectedObservationColumn,
                                }, headerRowIndex !== null ? headerRowIndex + 1 : 0));
                              }}
                              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0" }}
                            >
                              {detectedColumns.map((column, idx) => (
                                <option key={idx} value={idx}>{column}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="two-col">
                          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#E8EAF0" }}>
                            Coluna Status
                            <select
                              value={selectedStatusColumn ?? -1}
                              onChange={(e) => {
                                const nextIndex = Number(e.target.value);
                                const nextStatusIndex = nextIndex === -1 ? null : nextIndex;
                                setSelectedStatusColumn(nextStatusIndex);
                                setParsedActivities(buildParsedActivities(rawRows, {
                                  category: selectedCategoryColumn,
                                  activity: selectedActivityColumn,
                                  status: nextStatusIndex,
                                  responsible: selectedResponsibleColumn,
                                  observation: selectedObservationColumn,
                                }, headerRowIndex !== null ? headerRowIndex + 1 : 0));
                              }}
                              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0" }}
                            >
                              <option value={-1}>Não importar</option>
                              {detectedColumns.map((column, idx) => (
                                <option key={idx} value={idx}>{column}</option>
                              ))}
                            </select>
                          </label>

                          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#E8EAF0" }}>
                            Coluna Responsável
                            <select
                              value={selectedResponsibleColumn ?? -1}
                              onChange={(e) => {
                                const nextIndex = Number(e.target.value);
                                const nextResponsibleIndex = nextIndex === -1 ? null : nextIndex;
                                setSelectedResponsibleColumn(nextResponsibleIndex);
                                setParsedActivities(buildParsedActivities(rawRows, {
                                  category: selectedCategoryColumn,
                                  activity: selectedActivityColumn,
                                  status: selectedStatusColumn,
                                  responsible: nextResponsibleIndex,
                                  observation: selectedObservationColumn,
                                }, headerRowIndex !== null ? headerRowIndex + 1 : 0));
                              }}
                              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0" }}
                            >
                              <option value={-1}>Não importar</option>
                              {detectedColumns.map((column, idx) => (
                                <option key={idx} value={idx}>{column}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#E8EAF0" }}>
                            Coluna Observação
                            <select
                              value={selectedObservationColumn ?? -1}
                              onChange={(e) => {
                                const nextIndex = Number(e.target.value);
                                const nextObservationIndex = nextIndex === -1 ? null : nextIndex;
                                setSelectedObservationColumn(nextObservationIndex);
                                setParsedActivities(buildParsedActivities(rawRows, {
                                  category: selectedCategoryColumn,
                                  activity: selectedActivityColumn,
                                  status: selectedStatusColumn,
                                  responsible: selectedResponsibleColumn,
                                  observation: nextObservationIndex,
                                }, headerRowIndex !== null ? headerRowIndex + 1 : 0));
                              }}
                              style={{ background: "#181C27", border: "1px solid #2A3045", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0" }}
                            >
                              <option value={-1}>Não importar</option>
                              {detectedColumns.map((column, idx) => (
                                <option key={idx} value={idx}>{column}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}

                    <div style={{ border: "1px solid #2A3045", borderRadius: 8, overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
                      {parsedActivities.slice(0, 100).map((item, index) => (
                        <div key={`${item.category}-${index}`} className="import-row">
                          <span style={{ color: "#60A5FA" }}>{item.category}</span>
                          <span style={{ color: "#E8EAF0" }}>{item.activity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {editorMode === 'edit' && parseError && <p style={{ color: "#F87171", fontSize: 13, margin: "12px 0 0" }}>{parseError}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={closeModal} style={{ background: "transparent", border: "none", color: "#E8EAF0", padding: "9px 12px", cursor: "pointer" }}>Cancelar</button>
              <button
                onClick={editorMode === 'edit' ? updateChecklist : createChecklist}
                disabled={editorMode === 'edit' ? !editingChecklistTitle.trim() || saving : !title.trim() || saving}
                style={{ background: "#3B6EF5", border: "none", color: "white", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: (editorMode === 'edit' ? !editingChecklistTitle.trim() : !title.trim()) || saving ? "not-allowed" : "pointer", opacity: (editorMode === 'edit' ? !editingChecklistTitle.trim() : !title.trim()) || saving ? 0.65 : 1 }}
              >
                {saving ? (editorMode === 'edit' ? "Salvando..." : "Criando...") : editorMode === 'edit' ? "Salvar alterações" : parsedActivities.length > 0 ? "Confirmar importação" : "Criar vazio"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChecklistsPage />
    </Suspense>
  );
}
