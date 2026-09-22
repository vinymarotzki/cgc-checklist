'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { sasiAuthHeaders } from '@/lib/token';
import { useSasiToken } from '@/hooks/useSasiToken';
import LoadingScreen from '@/components/LoadingScreen';
import { Lock, ArrowLeft, History, Plus, Trash2, User } from 'lucide-react';

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

interface ConfirmModalState {
  type: 'activity' | 'category';
  id?: string;
  category?: string;
}

function groupByCategory(activities: Activity[]) {
  return activities.reduce<Record<string, Activity[]>>((acc, activity) => {
    if (!acc[activity.category]) acc[activity.category] = [];
    acc[activity.category].push(activity);
    return acc;
  }, {});
}

function AdminPageContent() {
  const searchParams = useSearchParams();
  const token = useSasiToken();
  const checklistId = searchParams.get('checklist') || '';
  const [activities, setActivities] = useState<Activity[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editingActivityValue, setEditingActivityValue] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [addingActivityForCategory, setAddingActivityForCategory] = useState<string | null>(null);
  const [newActivityDraft, setNewActivityDraft] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryDraft, setNewCategoryDraft] = useState('');
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    return checklistId ? `?checklist=${encodeURIComponent(checklistId)}` : '';
  }, [checklistId]);

  const fetchActivities = useCallback(async () => {
    if (!token) {
      setAuthError(true);
      setLoading(false);
      return;
    }

    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, { headers: sasiAuthHeaders(token) });
      if (!res.ok) {
        setAuthError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setActivities(data.activities || []);
      setUser(data.user || null);
    } catch {
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token, buildQuery]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const groupedActivities = useMemo(() => groupByCategory(activities), [activities]);
  const categoryNames = useMemo(() => Object.keys(groupedActivities).sort((a, b) => a.localeCompare(b)), [groupedActivities]);

  async function updateActivity(id: string, payload: Record<string, unknown>, onSuccess?: () => void) {
    setSaving(id);
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao atualizar atividade');
      }
      await fetchActivities();
      onSuccess?.();
      setNotice('Atividade atualizada com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao atualizar atividade.');
    } finally {
      setSaving(null);
    }
  }

  async function renameCategory(oldCategory: string, newCategory: string) {
    const trimmed = newCategory.trim();
    if (!trimmed || trimmed === oldCategory) {
      setEditingCategory(null);
      setEditingCategoryValue('');
      return;
    }

    setSaving(`category:${oldCategory}`);
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ oldCategory, category: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao renomear categoria');
      }
      await fetchActivities();
      setEditingCategory(null);
      setEditingCategoryValue('');
      setNotice('Categoria renomeada com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao renomear categoria.');
    } finally {
      setSaving(null);
    }
  }

  async function createActivity(category: string, activity: string) {
    const trimmedCategory = category.trim();
    const trimmedActivity = activity.trim();
    if (!trimmedCategory || !trimmedActivity) return;

    setSaving(`create:${category}`);
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ category: trimmedCategory, activity: trimmedActivity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao criar atividade');
      }
      setAddingActivityForCategory(null);
      setNewActivityDraft('');
      await fetchActivities();
      setNotice('Atividade criada com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao criar atividade.');
    } finally {
      setSaving(null);
    }
  }

  async function createCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving('create-category');
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ category: trimmed, activity: 'Nova atividade' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao criar categoria');
      }
      setCreatingCategory(false);
      setNewCategoryDraft('');
      await fetchActivities();
      setNotice('Categoria criada com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao criar categoria.');
    } finally {
      setSaving(null);
    }
  }

  async function deleteActivity(id: string) {
    setSaving(`delete:${id}`);
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao excluir atividade');
      }
      await fetchActivities();
      setConfirmModal(null);
      setNotice('Atividade excluída com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao excluir atividade.');
    } finally {
      setSaving(null);
    }
  }

  async function deleteCategory(category: string) {
    setSaving(`delete-category:${category}`);
    try {
      const query = buildQuery();
      const res = await fetch(`/api/activities${query}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...sasiAuthHeaders(token) },
        body: JSON.stringify({ category }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Falha ao excluir categoria');
      }
      await fetchActivities();
      setConfirmModal(null);
      setNotice('Categoria excluída com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao excluir categoria.');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <LoadingScreen message="Carregando administração..." />;
  }

  if (authError || !user) {
    return (
      <div style={{ minHeight: '100vh', background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, background: '#181C27', border: '1px solid #2A3045', borderRadius: 16, padding: 32, textAlign: 'center' }}>
          <Lock size={32} color="#F87171" style={{ marginBottom: 12 }} />
          <h1 style={{ color: '#E8EAF0', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Acesso negado</h1>
          <p style={{ color: '#7A82A0', fontSize: 14, lineHeight: 1.6 }}>Informe um token válido para acessar o painel administrativo.</p>
        </div>
      </div>
    );
  }

  if (!checklistId) {
    const checklistsHref = '/checklists';
    return (
      <div style={{ minHeight: '100vh', background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, background: '#181C27', border: '1px solid #2A3045', borderRadius: 16, padding: 32, textAlign: 'center' }}>
          <h1 style={{ color: '#E8EAF0', fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Selecione um checklist</h1>
          <p style={{ color: '#7A82A0', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>A edicao administrativa precisa estar vinculada a um checklist especifico.</p>
          <Link href={checklistsHref} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#3B6EF5', color: '#fff', borderRadius: 10, padding: '10px 16px', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            Ir para checklists
          </Link>
        </div>
      </div>
    );
  }

  const checklistHref = `/?checklist=${encodeURIComponent(checklistId)}`;
  const checklistsHref = '/checklists';
  const historyHref = '/history';

  return (
    <div style={{ minHeight: '100vh', background: '#0F1117', color: '#E8EAF0' }}>
      <header className="app-header">
        <div className="app-header-inner" style={{ flexDirection: 'row', flexWrap: 'nowrap' }}>
          <div className="app-nav" style={{ flexWrap: 'nowrap', width: 'auto' }}>
            <Link href={checklistHref} style={{ color: '#7A82A0', textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <ArrowLeft size={14} /> Checklist
            </Link>
            <Link href={historyHref} style={{ color: '#7A82A0', textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <History size={14} /> Histórico
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 6, background: '#1E2333',
              border: '1px solid #2A3045', color: '#E8EAF0', fontSize: 13, whiteSpace: 'nowrap'
            }}>
              <User size={14} color="#7A82A0" /> {user.name.split(' ')[0]}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        <div style={{ background: '#181C27', border: '1px solid #2A3045', borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Painel administrativo</h1>
              <p style={{ margin: '6px 0 0', color: '#7A82A0', fontSize: 14 }}>Gerencie categorias, atividades e conteúdo do checklist.</p>
            </div>
            <button
              onClick={() => {
                setCreatingCategory(true);
                setNewCategoryDraft('');
              }}
              style={{ border: 'none', borderRadius: 10, background: '#3B6EF5', color: '#fff', padding: '10px 14px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={16} /> Nova Categoria
            </button>
          </div>

          {creatingCategory && (
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <input
                value={newCategoryDraft}
                onChange={(event) => setNewCategoryDraft(event.target.value)}
                placeholder="Nome da nova categoria"
                style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 10, background: '#1E2333', border: '1px solid #2A3045', color: '#E8EAF0' }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createCategory(newCategoryDraft);
                  if (event.key === 'Escape') {
                    setCreatingCategory(false);
                    setNewCategoryDraft('');
                  }
                }}
              />
              <button onClick={() => createCategory(newCategoryDraft)} style={{ padding: '10px 14px', borderRadius: 10, background: '#10B981', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Criar
              </button>
              <button onClick={() => { setCreatingCategory(false); setNewCategoryDraft(''); }} style={{ padding: '10px 14px', borderRadius: 10, background: 'transparent', color: '#7A82A0', border: '1px solid #2A3045', cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          )}
        </div>

        {notice && (
          <div style={{ marginBottom: 16, background: '#1E2333', border: '1px solid #2A3045', borderRadius: 12, padding: '12px 14px', color: '#E8EAF0' }}>
            {notice}
          </div>
        )}

        {categoryNames.length === 0 ? (
          <div style={{ background: '#181C27', border: '1px solid #2A3045', borderRadius: 16, padding: 24, textAlign: 'center', color: '#7A82A0' }}>
            Nenhuma atividade cadastrada ainda.
          </div>
        ) : (
          categoryNames.map((category) => {
            const items = groupedActivities[category] || [];
            return (
              <section key={category} style={{ background: '#181C27', border: '1px solid #2A3045', borderRadius: 16, padding: 18, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3B6EF5' }} />
                    {editingCategory === category ? (
                      <input
                        value={editingCategoryValue}
                        onChange={(event) => setEditingCategoryValue(event.target.value)}
                        onBlur={() => renameCategory(category, editingCategoryValue)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') renameCategory(category, editingCategoryValue);
                          if (event.key === 'Escape') {
                            setEditingCategory(null);
                            setEditingCategoryValue('');
                          }
                        }}
                        autoFocus
                        style={{ background: '#1E2333', border: '1px solid #2A3045', borderRadius: 8, padding: '8px 10px', color: '#E8EAF0' }}
                      />
                    ) : (
                      <button onClick={() => { setEditingCategory(category); setEditingCategoryValue(category); }} style={{ background: 'transparent', border: 'none', color: '#E8EAF0', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        {category}
                      </button>
                    )}
                    <span style={{ color: '#7A82A0', fontSize: 13 }}>({items.length})</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setAddingActivityForCategory(category); setNewActivityDraft(''); }} style={{ padding: '8px 10px', borderRadius: 8, background: '#1E2333', border: '1px solid #2A3045', color: '#E8EAF0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> Adicionar
                    </button>
                    <button onClick={() => setConfirmModal({ type: 'category', category })} style={{ padding: '8px 10px', borderRadius: 8, background: 'transparent', border: '1px solid #2A3045', color: '#F87171', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Trash2 size={14} /> Excluir categoria
                    </button>
                  </div>
                </div>

                {addingActivityForCategory === category && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <input
                      value={newActivityDraft}
                      onChange={(event) => setNewActivityDraft(event.target.value)}
                      placeholder="Nova atividade"
                      style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 10, background: '#1E2333', border: '1px solid #2A3045', color: '#E8EAF0' }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') createActivity(category, newActivityDraft);
                        if (event.key === 'Escape') {
                          setAddingActivityForCategory(null);
                          setNewActivityDraft('');
                        }
                      }}
                    />
                    <button onClick={() => createActivity(category, newActivityDraft)} style={{ padding: '10px 14px', borderRadius: 10, background: '#3B6EF5', color: '#fff', border: 'none', cursor: 'pointer' }}>
                      Salvar
                    </button>
                    <button onClick={() => { setAddingActivityForCategory(null); setNewActivityDraft(''); }} style={{ padding: '10px 14px', borderRadius: 10, background: 'transparent', color: '#7A82A0', border: '1px solid #2A3045', cursor: 'pointer' }}>
                      Cancelar
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map((activity) => {
                    const isEditing = editingActivityId === activity.id;
                    return (
                      <div key={activity.id} style={{ background: '#1E2333', border: '1px solid #2A3045', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 240 }}>
                          {isEditing ? (
                            <input
                              value={editingActivityValue}
                              onChange={(event) => setEditingActivityValue(event.target.value)}
                              onBlur={() => updateActivity(activity.id, { activity: editingActivityValue }, () => {
                                setEditingActivityId(null);
                                setEditingActivityValue('');
                              })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  updateActivity(activity.id, { activity: editingActivityValue }, () => {
                                    setEditingActivityId(null);
                                    setEditingActivityValue('');
                                  });
                                }
                                if (event.key === 'Escape') {
                                  setEditingActivityId(null);
                                  setEditingActivityValue('');
                                }
                              }}
                              autoFocus
                              style={{ width: '100%', background: '#181C27', border: '1px solid #2A3045', borderRadius: 8, padding: '8px 10px', color: '#E8EAF0' }}
                            />
                          ) : (
                            <button onClick={() => { setEditingActivityId(activity.id); setEditingActivityValue(activity.activity); }} style={{ background: 'transparent', border: 'none', color: '#E8EAF0', cursor: 'pointer', textAlign: 'left', padding: 0, width: '100%' }}>
                              {activity.activity}
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#7A82A0', fontSize: 12 }}>{activity.status}</span>
                          <button onClick={() => setConfirmModal({ type: 'activity', id: activity.id })} style={{ padding: '8px 10px', borderRadius: 8, background: 'transparent', border: '1px solid #2A3045', color: '#F87171', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Trash2 size={14} /> Excluir
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </main>

      {confirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 }}>
          <div style={{ background: '#1E2333', border: '1px solid #2A3045', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', color: '#E8EAF0', fontSize: 18 }}>Confirmar exclusão</h3>
            <p style={{ margin: 0, color: '#7A82A0', lineHeight: 1.6 }}>
              {confirmModal.type === 'activity'
                ? 'Deseja excluir esta atividade?'
                : `Deseja excluir a categoria “${confirmModal.category}” e todas as atividades dela?`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmModal(null)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #2A3045', background: 'transparent', color: '#E8EAF0', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (confirmModal.type === 'activity' && confirmModal.id) deleteActivity(confirmModal.id);
                  if (confirmModal.type === 'category' && confirmModal.category) deleteCategory(confirmModal.category);
                }}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#F87171', color: '#fff', cursor: 'pointer' }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageContent />
    </Suspense>
  );
}
