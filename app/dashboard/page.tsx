'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import HazardsMap from './HazardsMap';

export const dynamic = 'force-dynamic';

type UserRole = 'viewer' | 'operator' | 'supervisor' | 'admin';
type SlaState = 'on_track' | 'near_breach' | 'breached' | 'closed';

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
  due_at?: string | null;
  resolved_at?: string | null;
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

interface SlaInfo {
  state: SlaState;
  label: string;
  detailText: string;
  bg: string;
  color: string;
  border: string;
}

const ROLE_LABELS: Record<UserRole, { label: string; color: string; bg: string }> = {
  viewer: { label: 'مراقب (قراءة فقط)', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
  operator: { label: 'مشغل عمليات', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
  supervisor: { label: 'مشرف ميداني', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
  admin: { label: 'مدير النظام', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
};

const SLA_HOURS_BY_SEVERITY: Record<string, number> = {
  'حرجة': 4,
  'عالية': 24,
  'متوسطة': 72,
  'منخفضة': 168,
};

function formatDurationArabic(ms: number): string {
  const absMs = Math.abs(ms);
  const totalMinutes = Math.floor(absMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} يوم و ${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة و ${minutes} دقيقة`;
  return `${Math.max(1, minutes)} دقيقة`;
}

function evaluateSla(hazard: Hazard, nowMs: number): SlaInfo {
  const createdMs = new Date(hazard.created_at).getTime();
  const fallbackHours = SLA_HOURS_BY_SEVERITY[hazard.severity || 'منخفضة'] || 168;
  const dueMs = hazard.due_at
    ? new Date(hazard.due_at).getTime()
    : createdMs + fallbackHours * 3600 * 1000;

  if (hazard.status === 'تم الحل') {
    const resolvedMs = hazard.resolved_at ? new Date(hazard.resolved_at).getTime() : nowMs;
    const withinSla = resolvedMs <= dueMs;
    return {
      state: 'closed',
      label: withinSla ? '✅ مغلق ضمن SLA' : '⚠️ مغلق بتأخير SLA',
      detailText: `الموعد المستهدف: ${new Date(dueMs).toLocaleString('ar-EG')}`,
      bg: withinSla ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
      color: withinSla ? '#6ee7b7' : '#fcd34d',
      border: withinSla ? '#10b981' : '#f59e0b',
    };
  }

  const remainingMs = dueMs - nowMs;
  const totalWindowMs = Math.max(1, dueMs - createdMs);
  const remainingRatio = remainingMs / totalWindowMs;

  if (remainingMs <= 0) {
    return {
      state: 'breached',
      label: '🔴 متجاوز للوقت (Breached)',
      detailText: `متأخر منذ ${formatDurationArabic(remainingMs)}`,
      bg: 'rgba(239, 68, 68, 0.2)',
      color: '#fca5a5',
      border: '#ef4444',
    };
  }

  // Near Breach: less than 25% of SLA window left or under 60 minutes remaining
  if (remainingRatio <= 0.25 || remainingMs <= 60 * 60 * 1000) {
    return {
      state: 'near_breach',
      label: '🟠 قرب الانتهاء (Near Breach)',
      detailText: `متبقي ${formatDurationArabic(remainingMs)}`,
      bg: 'rgba(249, 115, 22, 0.2)',
      color: '#fdba74',
      border: '#f97316',
    };
  }

  return {
    state: 'on_track',
    label: '🟢 ضمن الوقت (On Track)',
    detailText: `متبقي ${formatDurationArabic(remainingMs)}`,
    bg: 'rgba(34, 197, 94, 0.15)',
    color: '#86efac',
    border: '#22c55e',
  };
}

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
  const [slaFilter, setSlaFilter] = useState<string>('الكل');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    return createClient(url, key);
  }, []);

  // Refresh live SLA countdown every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
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
      setNowMs(Date.now());
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

  const enrichedHazards = hazards.map((h) => ({
    ...h,
    sla: evaluateSla(h, nowMs),
  }));

  const filteredHazards = enrichedHazards.filter((h) => {
    const matchSeverity = severityFilter === 'الكل' || h.severity === severityFilter;
    const matchStatus = statusFilter === 'الكل' || h.status === statusFilter;
    const matchSla = slaFilter === 'الكل' || h.sla.state === slaFilter;
    return matchSeverity && matchStatus && matchSla;
  });

  const stats = {
    total: hazards.length,
    newCount: hazards.filter((h) => h.status === 'جديد').length,
    inProgress: hazards.filter((h) => h.status === 'قيد المعالجة').length,
    resolved: hazards.filter((h) => h.status === 'تم الحل').length,
    slaBreached: enrichedHazards.filter((h) => h.sla.state === 'breached').length,
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
          <p style={styles.headerSub}>الرصد البلدي الذكي ومراقبة اتفاقيات مستوى الخدمة (SLA)</p>
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
        <div
          style={{
            ...styles.kpiCard,
            borderColor: stats.slaBreached > 0 ? '#ef4444' : '#334155',
          }}
        >
          <span style={styles.kpiLabel}>تجاوز SLA (متأخر)</span>
          <span style={{ ...styles.kpiValue, color: '#f87171' }}>{stats.slaBreached}</span>
        </div>
      </section>

      <section style={styles.filterBar}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>الخطورة:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={styles.select}
          >
            <option value="الكل">الكل</option>
            <option value="حرجة">حرجة (4 ساعات)</option>
            <option value="عالية">عالية (24 ساعة)</option>
            <option value="متوسطة">متوسطة (3 أيام)</option>
            <option value="منخفضة">منخفضة (7 أيام)</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>الحالة:</label>
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

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>مؤشر SLA:</label>
          <select
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            style={styles.select}
          >
            <option value="الكل">الكل</option>
            <option value="breached">🔴 متجاوز للوقت (Breached)</option>
            <option value="near_breach">🟠 قرب الانتهاء (Near Breach)</option>
            <option value="on_track">🟢 ضمن الوقت (On Track)</option>
            <option value="closed">✅ مغلق</option>
          </select>
        </div>

        {!canUpdateStatus && (
          <div style={styles.readOnlyNotice}>
            👁️ أنت في وضع القراءة فقط (Viewer) — التعديل غير مفعل لهذا الحساب
          </div>
        )}
      </section>

      <HazardsMap hazards={filteredHazards} onSelectHazard={handleSelectHazardFromMap} />

      <main style={styles.cardsGrid}>
        {filteredHazards.length === 0 ? (
          <div style={styles.emptyState}>لا توجد بلاغات مطابقة لمعايير التصفية الحالية.</div>
        ) : (
          filteredHazards.map((hazard) => {
            const isHighlighted = highlightedId === hazard.id;
            const autoEscalatedBySla = hazard.sla.state === 'breached' && !hazard.is_escalated;
            return (
              <article
                id={`hazard-card-${hazard.id}`}
                key={hazard.id}
                style={{
                  ...styles.card,
                  borderColor: isHighlighted
                    ? '#38bdf8'
                    : hazard.sla.state === 'breached'
                    ? '#ef4444'
                    : hazard.is_escalated
                    ? '#f59e0b'
                    : '#334155',
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
                    {(hazard.is_escalated || autoEscalatedBySla) && (
                      <span
                        style={{
                          ...styles.escalatedBanner,
                          backgroundColor: autoEscalatedBySla ? '#dc2626' : '#d97706',
                        }}
                      >
                        {autoEscalatedBySla ? '⏰ تصعيد تلقائي (تجاوز SLA)' : '🚨 بلاغ مُصعَّد للإدارة'}
                      </span>
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

                  {/* Live SLA Status Strip */}
                  <div
                    style={{
                      ...styles.slaStrip,
                      backgroundColor: hazard.sla.bg,
                      borderColor: hazard.sla.border,
                      color: hazard.sla.color,
                    }}
                  >
                    <span style={styles.slaTitle}>{hazard.sla.label}</span>
                    <span style={styles.slaDetail}>{hazard.sla.detailText}</span>
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
    gap: '16px',
    backgroundColor: '#1e293b',
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid #334155',
    marginBottom: '24px',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  filterLabel: {
    fontSize: '13px',
    color: '#cbd5e1',
    fontWeight: 600,
  },
  select: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '13px',
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
  slaStrip: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '12px',
  },
  slaTitle: {
    fontWeight: 700,
  },
  slaDetail: {
    fontWeight: 500,
    opacity: 0.9,
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
