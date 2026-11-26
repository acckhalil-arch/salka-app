'use client';

import React, { useEffect, useState } from 'react';

interface Hazard {
  id: number;
  created_at: string;
  sender: string;
  message: string;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  hazard_category: string | null;
  severity: string | null;
  ai_description: string | null;
  status: string;
}

export default function DashboardPage() {
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState('الكل');
  // العرض الافتراضي يعرض البلاغات النشطة فقط (يخفي "تم الحل")
  const [filterStatus, setFilterStatus] = useState('النشطة');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const fetchHazards = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hazards');
      const data = await res.json();
      if (data.hazards) {
        setHazards(data.hazards);
      }
    } catch (error) {
      console.error('Failed to load hazards:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHazards();
  }, []);

  const handleStatusChange = async (id: number, newStatus: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch('/api/hazards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        setHazards((prev) =>
          prev.map((h) => (h.id === id ? { ...h, status: newStatus } : h))
        );
        if (newStatus === 'بلاغ غير صحيح') {
          showToast(`🚫 تم تصنيف البلاغ #${id} كبلاغ غير صحيح / لا يوجد به خطر.`);
        } else if (newStatus === 'تم الحل') {
          showToast(`✅ تم حل البلاغ #${id} وإشعار المُبلّغ، وتمت أرشفته من القائمة النشطة.`);
        } else {
          showToast(`✅ تم تحديث حالة البلاغ #${id} إلى "${newStatus}" وإشعار المُبلّغ.`);
        }
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteHazard = async (id: number) => {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف البلاغ رقم #${id} نهائيًا؟\n(لا يمكن التراجع عن هذا الإجراء)`
    );
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/hazards?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setHazards((prev) => prev.filter((h) => h.id !== id));
        showToast(`🗑️ تم حذف البلاغ #${id} بنجاح.`);
      } else {
        showToast(`⚠️ تعذر حذف البلاغ #${id}، حاول مرة أخرى.`);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const getSeverityStyle = (severity: string | null): React.CSSProperties => {
    switch (severity) {
      case 'حرجة':
        return { backgroundColor: '#dc2626', color: '#ffffff' };
      case 'عالية':
        return { backgroundColor: '#ea580c', color: '#ffffff' };
      case 'متوسطة':
        return { backgroundColor: '#eab308', color: '#111827' };
      case 'منخفضة':
        return { backgroundColor: '#16a34a', color: '#ffffff' };
      default:
        return { backgroundColor: '#e2e8f0', color: '#475569' };
    }
  };

  const getStatusBorderColor = (status: string): string => {
    switch (status) {
      case 'تم الحل':
        return '#10b981';
      case 'قيد المعالجة':
        return '#3b82f6';
      case 'بلاغ غير صحيح':
        return '#94a3b8';
      default:
        return '#e2e8f0';
    }
  };

  const filteredHazards = hazards.filter((h) => {
    const matchSeverity =
      filterSeverity === 'الكل' || h.severity === filterSeverity;

    let matchStatus = true;
    if (filterStatus === 'النشطة') {
      matchStatus = h.status !== 'تم الحل' && h.status !== 'بلاغ غير صحيح';
    } else if (filterStatus !== 'الكل') {
      matchStatus = h.status === filterStatus;
    }

    return matchSeverity && matchStatus;
  });

  const validHazards = hazards.filter((h) => h.status !== 'بلاغ غير صحيح');

  const stats = {
    total: validHazards.length,
    high: validHazards.filter(
      (h) =>
        (h.severity === 'عالية' || h.severity === 'حرجة') &&
        h.status !== 'تم الحل'
    ).length,
    pending: validHazards.filter((h) => h.status !== 'تم الحل').length,
    resolved: validHazards.filter((h) => h.status === 'تم الحل').length,
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        color: '#0f172a',
        padding: '20px 16px 48px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Toast Notification */}
        {toastMsg && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '12px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
              zIndex: 1000,
              fontSize: '14px',
              fontWeight: 600,
              textAlign: 'center',
              maxWidth: '90vw',
            }}
          >
            {toastMsg}
          </div>
        )}

        {/* Header with Salka Logo */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '24px',
            backgroundColor: '#ffffff',
            padding: '18px 24px',
            borderRadius: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img
              src="/logo.png.jpg"
              alt="Salka App Logo"
              style={{
                width: '56px',
                height: '56px',
                objectFit: 'contain',
                borderRadius: '12px',
                backgroundColor: '#f8fafc',
                padding: '4px',
                border: '1px solid #e2e8f0',
              }}
            />
            <div>
              <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 800, color: '#0f172a' }}>
                لوحة تحكم البلاغات الذكية (Salka)
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                إدارة ومتابعة بلاغات الطرق والمرافق المحللة بالذكاء الاصطناعي عبر واتساب
              </p>
            </div>
          </div>

          <button
            onClick={fetchHazards}
            style={{
              backgroundColor: '#0f172a',
              color: '#ffffff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 تحديث البيانات
          </button>
        </div>

        {/* Stats Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '14px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRight: '4px solid #0f172a',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
              إجمالي البلاغات المعتمدة
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '6px' }}>
              {stats.total}
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRight: '4px solid #ea580c',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
              خطورة عالية / حرجة (نشطة)
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 800,
                marginTop: '6px',
                color: '#ea580c',
              }}
            >
              {stats.high}
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRight: '4px solid #2563eb',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
              قيد المتابعة
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 800,
                marginTop: '6px',
                color: '#2563eb',
              }}
            >
              {stats.pending}
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              borderRight: '4px solid #10b981',
            }}
          >
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
              تم الحل (مؤرشف)
            </div>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 800,
                marginTop: '6px',
                color: '#10b981',
              }}
            >
              {stats.resolved}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div
          style={{
            backgroundColor: '#ffffff',
            padding: '16px 20px',
            borderRadius: '14px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            marginBottom: '24px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>
              درجة الخطورة:
            </label>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                backgroundColor: '#f8fafc',
              }}
            >
              <option value="الكل">الكل</option>
              <option value="حرجة">حرجة</option>
              <option value="عالية">عالية</option>
              <option value="متوسطة">متوسطة</option>
              <option value="منخفضة">منخفضة</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>
              حالة البلاغ:
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                backgroundColor: '#f8fafc',
              }}
            >
              <option value="النشطة">البلاغات النشطة فقط (بدون المحلولة)</option>
              <option value="جديد">🆕 جديد</option>
              <option value="قيد المعالجة">🛠️ قيد المعالجة</option>
              <option value="تم الحل">✅ تم الحل (الأرشيف)</option>
              <option value="بلاغ غير صحيح">🚫 بلاغ غير صحيح</option>
              <option value="الكل">عرض الكل</option>
            </select>
          </div>
        </div>

        {/* Cards Grid */}
        {loading ? (
          <div
            style={{
              textAlign: 'center',
              padding: '48px',
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              color: '#64748b',
            }}
          >
            جاري تحميل البلاغات...
          </div>
        ) : filteredHazards.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '48px',
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              color: '#64748b',
            }}
          >
            🎉 لا توجد بلاغات نشطة مطابقة للفلتر المحدد حاليًا.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
              gap: '20px',
            }}
          >
            {filteredHazards.map((hazard) => {
              const isResolved = hazard.status === 'تم الحل';
              const isInvalid = hazard.status === 'بلاغ غير صحيح';

              return (
                <div
                  key={hazard.id}
                  style={{
                    backgroundColor: isResolved ? '#f0fdf4' : '#ffffff',
                    borderRadius: '16px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    opacity: isInvalid ? 0.72 : 1,
                    border: isResolved
                      ? '1px solid #86efac'
                      : '1px solid transparent',
                    borderTop: `4px solid ${getStatusBorderColor(hazard.status)}`,
                  }}
                >
                  {/* Image Wrapper */}
                  <div
                    style={{
                      position: 'relative',
                      height: '210px',
                      backgroundColor: '#e2e8f0',
                    }}
                  >
                    {hazard.image_url ? (
                      <img
                        src={hazard.image_url}
                        alt={hazard.hazard_category || 'بلاغ'}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#94a3b8',
                          fontSize: '14px',
                        }}
                      >
                        لا توجد صورة
                      </div>
                    )}

                    {/* ID Badge */}
                    <span
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        backgroundColor: 'rgba(15, 23, 42, 0.85)',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: '20px',
                      }}
                    >
                      #{hazard.id}
                    </span>

                    {/* Severity Badge */}
                    {hazard.severity && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '12px',
                          left: '12px',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '4px 12px',
                          borderRadius: '20px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                          ...getSeverityStyle(hazard.severity),
                        }}
                      >
                        {hazard.severity}
                      </span>
                    )}
                  </div>

                  {/* Card Body */}
                  <div
                    style={{
                      padding: '18px',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '8px',
                        }}
                      >
                        <h2
                          style={{
                            margin: 0,
                            fontSize: '17px',
                            fontWeight: 800,
                            color: '#0f172a',
                          }}
                        >
                          {hazard.hazard_category || 'بلاغ غير مصنف'}
                        </h2>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {new Date(hazard.created_at).toLocaleDateString('ar-EG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <p
                        style={{
                          margin: '0 0 16px',
                          fontSize: '13.5px',
                          color: '#475569',
                          lineHeight: 1.6,
                        }}
                      >
                        {hazard.ai_description || hazard.message}
                      </p>
                    </div>

                    {/* Card Footer */}
                    <div
                      style={{
                        paddingTop: '14px',
                        borderTop: '1px solid #f1f5f9',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {hazard.latitude && hazard.longitude ? (
                        <a
                          href={`https://www.google.com/maps?q=${hazard.latitude},${hazard.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block',
                            textAlign: 'center',
                            backgroundColor: '#eff6ff',
                            color: '#1d4ed8',
                            textDecoration: 'none',
                            fontSize: '13px',
                            fontWeight: 700,
                            padding: '9px 12px',
                            borderRadius: '10px',
                          }}
                        >
                          📍 فتح الموقع على خرائط Google
                          {hazard.location_name ? ` (${hazard.location_name})` : ''}
                        </a>
                      ) : (
                        <div
                          style={{
                            textAlign: 'center',
                            backgroundColor: '#fffbeb',
                            color: '#b45309',
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '8px',
                            borderRadius: '8px',
                          }}
                        >
                          ⚠️ بانتظار إرسال الموقع الجغرافي
                        </div>
                      )}

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '2px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#64748b',
                          }}
                        >
                          حالة البلاغ:
                        </span>
                        <select
                          disabled={
                            updatingId === hazard.id || deletingId === hazard.id
                          }
                          value={hazard.status || 'جديد'}
                          onChange={(e) =>
                            handleStatusChange(hazard.id, e.target.value)
                          }
                          style={{
                            border: '1px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '6px 12px',
                            fontSize: '13px',
                            fontWeight: 700,
                            backgroundColor: '#f8fafc',
                            color: '#0f172a',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="جديد">🆕 جديد</option>
                          <option value="قيد المعالجة">🛠️ قيد المعالجة</option>
                          <option value="تم الحل">✅ تم الحل</option>
                          <option value="بلاغ غير صحيح">🚫 بلاغ غير صحيح</option>
                        </select>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteHazard(hazard.id)}
                        disabled={deletingId === hazard.id}
                        style={{
                          marginTop: '4px',
                          width: '100%',
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          cursor:
                            deletingId === hazard.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {deletingId === hazard.id
                          ? 'جاري الحذف...'
                          : '🗑️ حذف البلاغ نهائيًا'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
