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
  const [filterStatus, setFilterStatus] = useState('الكل');
  const [updatingId, setUpdatingId] = useState<number | null>(null);

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
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const getSeverityBadge = (severity: string | null) => {
    switch (severity) {
      case 'حرجة':
        return 'bg-red-600 text-white';
      case 'عالية':
        return 'bg-orange-500 text-white';
      case 'متوسطة':
        return 'bg-yellow-400 text-gray-900';
      case 'منخفضة':
        return 'bg-green-500 text-white';
      default:
        return 'bg-gray-200 text-gray-700';
    }
  };

  const filteredHazards = hazards.filter((h) => {
    const matchSeverity =
      filterSeverity === 'الكل' || h.severity === filterSeverity;
    const matchStatus = filterStatus === 'الكل' || h.status === filterStatus;
    return matchSeverity && matchStatus;
  });

  const stats = {
    total: hazards.length,
    high: hazards.filter((h) => h.severity === 'عالية' || h.severity === 'حرجة')
      .length,
    pending: hazards.filter((h) => h.status !== 'تم الحل').length,
    resolved: hazards.filter((h) => h.status === 'تم الحل').length,
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
              🚦 لوحة تحكم البلاغات الذكية (Salka)
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              متابعة بلاغات الطرق والمرافق المحللة بالذكاء الاصطناعي عبر واتساب
            </p>
          </div>
          <button
            onClick={fetchHazards}
            className="self-start md:self-auto bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition cursor-pointer"
          >
            🔄 تحديث البيانات
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">إجمالي البلاغات</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">خطورة عالية / حرجة</p>
            <p className="text-2xl font-bold text-orange-600 mt-1">{stats.high}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">قيد المتابعة</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{stats.pending}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">تم الحل</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.resolved}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">درجة الخطورة:</label>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              <option value="الكل">الكل</option>
              <option value="حرجة">حرجة</option>
              <option value="عالية">عالية</option>
              <option value="متوسطة">متوسطة</option>
              <option value="منخفضة">منخفضة</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">حالة البلاغ:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              <option value="الكل">الكل</option>
              <option value="جديد">جديد</option>
              <option value="قيد المعالجة">قيد المعالجة</option>
              <option value="تم الحل">تم الحل</option>
            </select>
          </div>
        </div>

        {/* Reports Grid */}
        {loading ? (
          <div className="text-center py-16 text-slate-500">جاري تحميل البلاغات...</div>
        ) : filteredHazards.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-100 text-slate-500">
            لا توجد بلاغات مطابقة للفلتر المحدد.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredHazards.map((hazard) => (
              <div
                key={hazard.id}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col"
              >
                {/* Image */}
                <div className="relative h-52 bg-slate-200">
                  {hazard.image_url ? (
                    <img
                      src={hazard.image_url}
                      alt={hazard.hazard_category || 'بلاغ'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                      لا توجد صورة
                    </div>
                  )}
                  <span className="absolute top-3 right-3 bg-slate-900/80 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    #{hazard.id}
                  </span>
                  {hazard.severity && (
                    <span
                      className={`absolute top-3 left-3 text-xs font-bold px-3 py-1 rounded-full shadow-sm ${getSeverityBadge(
                        hazard.severity
                      )}`}
                    >
                      {hazard.severity}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h2 className="font-bold text-lg text-slate-800">
                        {hazard.hazard_category || 'بلاغ غير مصنف'}
                      </h2>
                      <span className="text-xs text-slate-400">
                        {new Date(hazard.created_at).toLocaleDateString('ar-EG', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <p className="text-sm text-slate-600 leading-relaxed mb-4">
                      {hazard.ai_description || hazard.message}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex flex-col gap-3">
                    {/* Location Link */}
                    {hazard.latitude && hazard.longitude ? (
                      <a
                        href={`https://www.google.com/maps?q=${hazard.latitude},${hazard.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 w-full bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold py-2 px-3 rounded-lg transition"
                      >
                        📍 فتح الموقع على خرائط Google
                        {hazard.location_name ? ` (${hazard.location_name})` : ''}
                      </a>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 py-1.5 px-3 rounded-lg text-center">
                        ⚠️ بانتظار إرسال الموقع الجغرافي
                      </span>
                    )}

                    {/* Status Control */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 font-medium">الحالة:</span>
                      <select
                        disabled={updatingId === hazard.id}
                        value={hazard.status || 'جديد'}
                        onChange={(e) =>
                          handleStatusChange(hazard.id, e.target.value)
                        }
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-slate-50 text-slate-800 cursor-pointer"
                      >
                        <option value="جديد">🆕 جديد</option>
                        <option value="قيد المعالجة">🛠️ قيد المعالجة</option>
                        <option value="تم الحل">✅ تم الحل</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
