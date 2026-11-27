'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import HazardsMap from './HazardsMap';

export const dynamic = 'force-dynamic';

type UserRole = 'viewer' | 'operator' | 'supervisor' | 'admin';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department: string;
  is_active: boolean;
}

interface Hazard {
  id: number;
  created_at: string;
  sender: string;
  message: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  hazard_category: string | null;
  severity: string | null;
  ai_description: string | null;
  status: string;
  is_escalated?: boolean;
  assigned_to?: string | null;
}

const ROLE_LABELS: Record<UserRole, { label: string; color: string; bg: string }> = {
  viewer: { label: 'مراقب (قراءة فقط)', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
  operator: { label: 'مشغل عمليات', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
  supervisor: { label: 'مشرف ميداني', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
  admin: { label: 'مدير النظام', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
};

export default function DashboardPage() {
  const router = useRouter();
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('الكل');
  const [statusFilter, setStatusFilter] = useState<string>('الكل');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    return createClient(url, key);
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchHazards = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/hazards', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.hazards) setHazards(data.hazards);
      if (data.currentUser) setCurrentUser(data.currentUser);
    } catch {
      showToast('تعذر تحميل بيانات البلاغات', 'error');
    } finally {
      setLoading(false);
    }
  }, [router, supabase]);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (!session) {
        router.replace('/login');
        return;
      }
      setAccessToken(session.access_token);
      fetchHazards(session.access_token);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login');
      } else {
        setAccessToken(session.access_token);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [router, supabase, fetchHazards]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const handleSelectHazardFromMap = useCallback((id: number) => {
    setHighlightedId(id);
    const el = document.getElementById(`hazard-card-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => setHighlightedId(null), 3500);
  }, []);

  const handleStatusChange = async (id: number, newStatus: string) => {
    if (!accessToken) return;
    setUpdatingId(id);

    try {
      const res = await fetch('/api/hazards', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id, status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'فشل تحديث الحالة', 'error');
      } else {
        setHazards((prev) => prev.map((h) => (h.id === id ? data.hazard : h)));
        showToast(`تم تحديث البلاغ #${id} إلى "${newStatus}"`);
      }
    } catch {
      showToast('خطأ في الاتصال بالخادم', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleEscalateToggle = async (hazard: Hazard) => {
    if (!accessToken) return;
    setUpdatingId(hazard.id);
    const nextEscalate = !hazard.is_escalated;

    try {
      const res = await fetch('/api/hazards', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: hazard.id, is_escalated: nextEscalate }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'فشل تحديث التصعيد', 'error');
      } else {
        setHazards((prev) => prev.map((h) => (h.id === hazard.id ? data.hazard : h)));
        showToast(nextEscalate ? `تم تصعيد البلاغ #${hazard.id} للإدارة العليا` : `تم إلغاء تصعيد البلاغ #${hazard.id}`);
      }
    } catch {
      showToast('خطأ في الاتصال بالخادم', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!accessToken) return;
    if (!window.confirm(`هل أنت متأكد من حذف البلاغ #${id} نهائياً؟`)) return;

    setUpdatingId(id);
    try {
      const res = await fetch(`/api/hazards?id=${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'فشل حذف البلاغ', 'error');
      } else {
        setHazards((prev) => prev.filter((h) => h.id !== id));
        showToast(`تم حذف البلاغ #${id}`);
      }
    } catch {
      showToast('خطأ في الاتصال بالخادم', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const getSeverityBadgeStyle = (severity: string | null): React.CSSProperties => {
    switch (severity) {
      case 'حرجة':
        return { backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid #ef4444' };
      case 'عالية':
        return { backgroundColor: 'rgba(249, 115, 22, 0.2)', color: '#fdba74', border: '1px solid #f97316' };
      case 'متوسطة':
        return { backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#fde047', border: '1px solid #eab308' };
      default:
        return { backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#86efac', border: '1px solid #22c55e' };
    }
  };

  if (loading) {
    return (
      <div dir="rtl" style={styles.loadingScreen}>
        <div>جاري تحميل غرفة عمليات سالكة والتحقق من الصلاحيات...</div>
      </div>
    );
  }

  const userRole: UserRole = currentUser?.role || 'viewer';
  const canUpdateStatus = ['operator', 'supervisor', 'admin'].includes(userRole);
  const canEscalate = ['supervisor', 'admin'].includes(userRole);
  const canDelete = userRole === 'admin';
  const roleMeta = ROLE_LABELS[userRole];

  const filteredHazards = hazards.filter((h) => {
    const matchSeverity = severityFilter === 'الكل' || h.severity === severityFilter;
    const matchStatus = statusFilter === 'الكل' || h.status === statusFilter;
    return matchSeverity && matchStatus;
  });

  const stats = {
    total: hazards.length,
    newCount: hazards.filter((h) => h.status === 'جديد').length,
    inProgress: hazards.filter((h) => h.status === 'قيد المعالجة').length,
    resolved: hazards.filter((h) => h.status === 'تم الحل').length,
    critical: hazards.filter((h) => h.severity === 'حرجة' && h.status !== 'تم الحل').length,
  };

  return (
    <div dir="rtl" style={styles.page}>
      {toast && (
        <div
          style={{
            ...styles.toast,
            backgroundColor: toast.type === 'error' ? '#991b1b' : '#065f46',
            borderColor: toast.type === 'error' ? '#ef4444' : '#10b981',
          }}
        >
          {toast.message}
        </div>
      )}

      <header style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>غرفة العمليات المركزية — منصة سالكة</h1>
          <p style={styles.headerSub}>الرصد البلدي الذكي والاستجابة الميدانية الفورية</p>
        </div>

        <div style={styles.userBar}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>{currentUser?.full_name || currentUser?.email}</span>
            <span
              style={{
                ...styles.roleBadge,
                color: roleMeta.color,
                backgroundColor: roleMeta.bg,
                border: `1px solid ${roleMeta.color}`,
              }}
            >
              {roleMeta.label}
            </span>
          </div>
          <button
            onClick={() => accessToken && fetchHazards(accessToken)}
            style={styles.refreshBtn}
            title="تحديث البيانات"
          >
            🔄 تحديث
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>
            تسجيل الخروج
          </button>
        </div>
      </header>

      <section style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <span style={styles.kpiLabel}>إجمالي البلاغات</span>
          <span style={styles.kpiValue}>{stats.total}</span>
        </div>
        <div style={styles.kpiCard}>
          <span style={styles.kpiLabel}>بلاغات جديدة</span>
          <span style={{ ...styles.kpiValue, color: '#38bdf8' }}>{stats.newCount}</span>
        </div>
        <div style={styles.kpiCard}>
          <span style={styles.kpiLabel}>قيد المعالجة</span>
          <span style={{ ...styles.kpiValue, color: '#fbbf24' }}>{stats.inProgress}</span>
        </div>
        <div style={styles.kpiCard}>
          <span style={styles.kpiLabel}>تم الحل</span>
          <span style={{ ...styles.kpiValue, color: '#34d399' }}>{stats.resolved}</span>
        </div>
        <div style={styles.kpiCard}>
          <span style={styles.kpiLabel}>حالات حرجة نشطة</span>
          <span style={{ ...styles.kpiValue, color: '#f87171' }}>{stats.critical}</span>
        </div>
      </section>

      <section style={styles.filterBar}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>تصفية حسب الخطورة:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={styles.select}
          >
            <option value="الكل">الكل</option>
            <option value="حرجة">حرجة</option>
            <option value="عالية">عالية</option>
            <option value="متوسطة">متوسطة</option>
            <option value="منخفضة">منخفضة</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>تصفية حسب الحالة:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.select}
          >
            <option value="الكل">الكل</option>
            <option value="جديد">جديد</option>
            <option value="قيد المعالجة">قيد المعالجة</option>
            <option value="تم الحل">تم الحل</option>
          </select>
        </div>

        {!canUpdateStatus && (
          <div style={styles.readOnlyNotice}>
            👁️ أنت في وضع القراءة فقط (Viewer) — التعديل غير مفعل لهذا الحساب
          </div>
        )}
      </section>

      {/* Interactive GIS Operations Map */}
      <HazardsMap hazards={filteredHazards} onSelectHazard={handleSelectHazardFromMap} />

      <main style={styles.cardsGrid}>
        {filteredHazards.length === 0 ? (
          <div style={styles.emptyState}>لا توجد بلاغات مطابقة لمعايير التصفية الحالية.</div>
        ) : (
          filteredHazards.map((hazard) => {
            const isHighlighted = highlightedId === hazard.id;
            return (
              <article
                id={`hazard-card-${hazard.id}`}
                key={hazard.id}
                style={{
                  ...styles.card,
                  borderColor: isHighlighted ? '#38bdf8' : hazard.is_escalated ? '#f59e0b' : '#334155',
                  boxShadow: isHighlighted ? '0 0 0 3px rgba(56, 189, 248, 0.4)' : 'none',
                }}
              >
                {hazard.image_url && (
                  <div style={styles.imageWrapper}>
                    <img
                      src={hazard.image_url}
                      alt={hazard.hazard_category || 'صورة البلاغ'}
                      style={styles.cardImage}
                    />
                    {hazard.is_escalated && (
                      <span style={styles.escalatedBanner}>🚨 بلاغ مُصعَّد للإدارة</span>
                    )}
                  </div>
                )}

                <div style={styles.cardBody}>
                  <div style={styles.cardTopRow}>
                    <span style={styles.ticketId}>بلاغ #{hazard.id}</span>
                    <span style={{ ...styles.badge, ...getSeverityBadgeStyle(hazard.severity) }}>
                      {hazard.severity || 'غير محدد'}
                    </span>
                  </div>

                  <h3 style={styles.categoryTitle}>{hazard.hazard_category || 'رصد بلدي عام'}</h3>
                  <p style={styles.description}>{hazard.ai_description || hazard.message || 'لا يوجد وصف'}</p>

                  <div style={styles.metaList}>
                    <div>📅 {new Date(hazard.created_at).toLocaleString('ar-EG')}</div>
                    <div>📱 المبلّغ: <span dir="ltr">{hazard.sender}</span></div>
                    {hazard.latitude && hazard.longitude ? (
                      <div>
                        📍{' '}
                        <a
                          href={`https://www.google.com/maps?q=${hazard.latitude},${hazard.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.mapLink}
                        >
                          عرض الموقع على الخريطة ({hazard.latitude.toFixed(4)}, {hazard.longitude.toFixed(4)})
                        </a>
                      </div>
                    ) : (
                      <div style={{ color: '#64748b' }}>📍 لم يتم إرفاق إحداثيات GPS</div>
                    )}
                  </div>

                  <div style={styles.actionsBox}>
                    <div style={styles.statusRow}>
                      <span style={styles.statusLabel}>حالة المعالجة:</span>
                      {canUpdateStatus ? (
                        <select
                          disabled={updatingId === hazard.id}
                          value={hazard.status}
                          onChange={(e) => handleStatusChange(hazard.id, e.target.value)}
                          style={styles.statusSelect}
                        >
                          <option value="جديد">جديد</option>
                          <option value="قيد المعالجة">قيد المعالجة</option>
                          <option value="تم الحل">تم الحل</option>
                        </select>
                      ) : (
                        <span style={styles.readOnlyStatus}>{hazard.status}</span>
                      )}
                    </div>

                    {(canEscalate || canDelete) && (
                      <div style={styles.supervisorRow}>
                        {canEscalate && (
                          <button
                            disabled={updatingId === hazard.id}
                            onClick={() => handleEscalateToggle(hazard)}
                            style={{
                              ...styles.escalateBtn,
                              backgroundColor: hazard.is_escalated ? '#b45309' : '#334155',
                            }}
                          >
                            {hazard.is_escalated ? 'إلغاء التصعيد' : '⚡ تصعيد البلاغ'}
                          </button>
                        )}

                        {canDelete && (
                          <button
                            disabled={updatingId === hazard.id}
                            onClick={() => handleDelete(hazard.id)}
                            style={styles.deleteBtn}
                          >
                            🗑️ حذف
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingScreen: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#cbd5e1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  toast: {
    position: 'fixed',
    bottom: '24px',
    left: '24px',
    zIndex: 9999,
    padding: '14px 20px',
    borderRadius: '10px',
    border: '1px solid',
    color: '#ffffff',
    fontWeight: 600,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    paddingBottom: '20px',
    borderBottom: '1px solid #1e293b',
    marginBottom: '24px',
  },
  headerTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 4px 0',
    color: '#f8fafc',
  },
  headerSub: {
    fontSize: '14px',
    color: '#94a3b8',
    margin: 0,
  },
  userBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#1e293b',
    padding: '8px 14px',
    borderRadius: '10px',
    border: '1px solid #334155',
  },
  userName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  roleBadge: {
    fontSize: '12px',
    fontWeight: 700,
    padding: '2px 10px',
    borderRadius: '9999px',
  },
  refreshBtn: {
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid #334155',
    padding: '9px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  logoutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#fca5a5',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    padding: '9px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  kpiCard: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  kpiLabel: {
    fontSize: '13px',
    color: '#94a3b8',
  },
  kpiValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#f8fafc',
  },
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '20px',
    backgroundColor: '#1e293b',
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid #334155',
    marginBottom: '24px',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  filterLabel: {
    fontSize: '14px',
    color: '#cbd5e1',
    fontWeight: 600,
  },
  select: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '14px',
  },
  readOnlyNotice: {
    marginRight: 'auto',
    fontSize: '13px',
    color: '#94a3b8',
    backgroundColor: '#0f172a',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid #334155',
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '20px',
  },
  emptyState: {
    gridColumn: '1 / -1',
    textAlign: 'center',
    padding: '48px',
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    color: '#94a3b8',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '14px',
    border: '1px solid #334155',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 0.25s, box-shadow 0.25s',
  },
  imageWrapper: {
    position: 'relative',
    width: '100%',
    height: '200px',
    backgroundColor: '#0f172a',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  escalatedBanner: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    backgroundColor: '#d97706',
    color: '#ffffff',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 700,
  },
  cardBody: {
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1,
  },
  cardTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketId: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#94a3b8',
  },
  badge: {
    fontSize: '12px',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '9999px',
  },
  categoryTitle: {
    fontSize: '17px',
    fontWeight: 700,
    margin: 0,
    color: '#f8fafc',
  },
  description: {
    fontSize: '14px',
    color: '#cbd5e1',
    lineHeight: 1.5,
    margin: 0,
  },
  metaList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    color: '#94a3b8',
    backgroundColor: '#0f172a',
    padding: '10px 12px',
    borderRadius: '8px',
  },
  mapLink: {
    color: '#38bdf8',
    textDecoration: 'none',
    fontWeight: 600,
  },
  actionsBox: {
    marginTop: 'auto',
    paddingTop: '12px',
    borderTop: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: '13px',
    color: '#cbd5e1',
    fontWeight: 600,
  },
  statusSelect: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: '8px',
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  readOnlyStatus: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#38bdf8',
  },
  supervisorRow: {
    display: 'flex',
    gap: '8px',
  },
  escalateBtn: {
    flex: 1,
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: '8px',
    padding: '7px 10px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  deleteBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#fca5a5',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
