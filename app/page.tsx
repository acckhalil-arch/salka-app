'use client';

import React, { useState } from 'react';
import Link from 'next/link';

// ضع هنا رقم الواتساب الخاص بالمنصة بصيغة دولية بدون علامة +
const WHATSAPP_NUMBER = '201283860700';
const WHATSAPP_PREFILL_TEXT = encodeURIComponent(
  'مرحباً سالكة، أود الإبلاغ عن خطر في الطريق.'
);

export default function HomePage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedReport, setSubmittedReport] = useState<{
    id: number;
    hazard_category: string;
    severity: string;
    ai_description: string;
  } | null>(null);

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_PREFILL_TEXT}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(
    whatsappUrl
  )}`;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    setSubmittedReport(null);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleGetLocation = () => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError('المتصفح لا يدعم تحديد الموقع الجغرافي.');
      return;
    }

    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(Number(pos.coords.latitude.toFixed(6)));
        setLongitude(Number(pos.coords.longitude.toFixed(6)));
        setLocLoading(false);
      },
      (err) => {
        setLocLoading(false);
        if (err.code === 1) {
          setLocError('تم رفض إذن الموقع. يرجى تفعيل GPS والسماح للمتصفح بالوصول للموقع.');
        } else {
          setLocError('تعذر تحديد الموقع حاليًا، تأكد من تفعيل GPS وحاول مجددًا.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!imageFile) {
      setSubmitError('من فضلك التقط أو اختر صورة للمشكلة أولًا.');
      return;
    }
    if (latitude === null || longitude === null) {
      setSubmitError('من فضلك اضغط على زر "تحديد موقعي الحالي (GPS)" لإرفاق الموقع.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('latitude', String(latitude));
      formData.append('longitude', String(longitude));
      if (notes.trim()) formData.append('notes', notes.trim());
      if (phone.trim()) formData.append('phone', phone.trim());

      const res = await fetch('/api/web-report', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'حدث خطأ أثناء إرسال البلاغ.');
      } else {
        setSubmittedReport(data.report);
        setImageFile(null);
        setImagePreview(null);
        setNotes('');
      }
    } catch {
      setSubmitError('تعذر الاتصال بالخادم، تأكد من اتصال الإنترنت.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        color: '#0f172a',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: '20px 16px 48px',
      }}
    >
      <div style={{ maxWidth: '1040px', margin: '0 auto' }}>
        {/* Top Navbar */}
        <header
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '18px',
            padding: '16px 24px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '14px',
            marginBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/logo.png.jpg"
              alt="Salka App"
              style={{
                width: '52px',
                height: '52px',
                objectFit: 'contain',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '3px',
              }}
            />
            <div>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
                منصة سالكة (Salka App)
              </h1>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                المنظومة الذكية للإبلاغ الفوري عن مخاطر الطرق والمرافق
              </p>
            </div>
          </div>

          <Link
            href="/dashboard"
            style={{
              backgroundColor: '#0f172a',
              color: '#ffffff',
              textDecoration: 'none',
              padding: '10px 18px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: 700,
            }}
          >
            📊 لوحة تحكم العمليات
          </Link>
        </header>

        {/* Main 2-Column Grid: Web Portal + WhatsApp QR */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '22px',
            alignItems: 'start',
          }}
        >
          {/* Card 1: Direct Web Browser Reporting */}
          <section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              padding: '24px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              borderTop: '4px solid #ea580c',
            }}
          >
            <h2 style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 800 }}>
              📸 إرسال بلاغ مباشر من المتصفح
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>
              التقط صورة للمشكلة وحدد موقعك الجغرافي ليقوم الذكاء الاصطناعي بتحليلها وتوجيهها فورًا.
            </p>

            {submittedReport && (
              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '20px',
                  color: '#14532d',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '15px', marginBottom: '6px' }}>
                  ✅ تم استلام وتحليل بلاغك بنجاح (رقم #{submittedReport.id})
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  <div>
                    <strong>🔍 التصنيف:</strong> {submittedReport.hazard_category}
                  </div>
                  <div>
                    <strong>⚠️ درجة الخطورة:</strong> {submittedReport.severity}
                  </div>
                  <div>
                    <strong>📝 التقييم الفني:</strong> {submittedReport.ai_description}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Step 1: Image Upload / Camera */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13.5px',
                    fontWeight: 700,
                    marginBottom: '8px',
                    color: '#1e293b',
                  }}
                >
                  1. صورة الخطر (التقاط بالكاميرا أو اختيار من الجهاز) *
                </label>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px dashed #cbd5e1',
                    borderRadius: '12px',
                    padding: '18px',
                    backgroundColor: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: '26px', marginBottom: '6px' }}>📷</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                    {imageFile ? imageFile.name : 'اضغط هنا لالتقاط صورة أو اختيار ملف'}
                  </span>
                  <span style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
                    JPG, PNG, WEBP
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageChange}
                    style={{ display: 'none' }}
                  />
                </label>

                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="معاينة الصورة"
                    style={{
                      marginTop: '12px',
                      width: '100%',
                      maxHeight: '220px',
                      objectFit: 'cover',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                    }}
                  />
                )}
              </div>

              {/* Step 2: GPS Location */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13.5px',
                    fontWeight: 700,
                    marginBottom: '8px',
                    color: '#1e293b',
                  }}
                >
                  2. الموقع الجغرافي (GPS) *
                </label>
                <button
                  type="button"
                  onClick={handleGetLocation}
                  disabled={locLoading}
                  style={{
                    width: '100%',
                    backgroundColor: latitude !== null ? '#ecfdf5' : '#eff6ff',
                    color: latitude !== null ? '#047857' : '#1d4ed8',
                    border: `1px solid ${latitude !== null ? '#6ee7b7' : '#bfdbfe'}`,
                    borderRadius: '10px',
                    padding: '11px 14px',
                    fontSize: '13.5px',
                    fontWeight: 700,
                    cursor: locLoading ? 'wait' : 'pointer',
                  }}
                >
                  {locLoading
                    ? '⏳ جاري تحديد إحداثيات الموقع...'
                    : latitude !== null && longitude !== null
                    ? `✅ تم تحديد الموقع (${latitude}, ${longitude})`
                    : '📍 اضغط لتحديد موقعي الحالي تلقائيًا'}
                </button>
                {locError && (
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#dc2626' }}>
                    {locError}
                  </p>
                )}
              </div>

              {/* Step 3: Optional Phone & Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 700,
                      marginBottom: '6px',
                      color: '#475569',
                    }}
                  >
                    رقم الهاتف للمتابعة (اختياري)
                  </label>
                  <input
                    type="tel"
                    placeholder="مثال: 010xxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13.5px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 700,
                      marginBottom: '6px',
                      color: '#475569',
                    }}
                  >
                    ملاحظات إضافية (اختياري)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="اكتب أي تفاصيل تساعد فريق الصيانة..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13.5px',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>

              {submitError && (
                <div
                  style={{
                    backgroundColor: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fecaca',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  ⚠️ {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  backgroundColor: submitting ? '#94a3b8' : '#ea580c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '13px 18px',
                  fontSize: '15px',
                  fontWeight: 800,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 12px rgba(234, 88, 12, 0.25)',
                }}
              >
                {submitting
                  ? '🤖 جاري رفع الصورة وتحليل الخطر بالذكاء الاصطناعي...'
                  : '🚀 إرسال البلاغ الآن'}
              </button>
            </form>
          </section>

          {/* Card 2: WhatsApp QR Code Channel */}
          <section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              padding: '24px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              borderTop: '4px solid #16a34a',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                backgroundColor: '#dcfce7',
                color: '#15803d',
                fontSize: '12px',
                fontWeight: 800,
                padding: '5px 12px',
                borderRadius: '20px',
                marginBottom: '12px',
              }}
            >
              💬 الإبلاغ السريع عبر واتساب
            </div>

            <h2 style={{ margin: '0 0 8px', fontSize: '19px', fontWeight: 800 }}>
              امسح الكود وأبلغ في ثوانٍ
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
              وجّه كاميرا هاتفك نحو رمز الـ QR لفتح محادثة <strong>Salka</strong> مباشرة على واتساب وإرسال الصورة والموقع.
            </p>

            {/* QR Box */}
            <div
              style={{
                display: 'inline-block',
                padding: '14px',
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '2px solid #e2e8f0',
                boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                marginBottom: '18px',
              }}
            >
              <img
                src={qrImageUrl}
                alt="WhatsApp QR Code - Salka App"
                style={{
                  width: '210px',
                  height: '210px',
                  display: 'block',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  textDecoration: 'none',
                  padding: '13px 18px',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 800,
                  boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)',
                }}
              >
                📲 فتح محادثة واتساب مباشرة
              </a>
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '12px',
                padding: '14px',
                textAlign: 'right',
                fontSize: '12.5px',
                color: '#475569',
                lineHeight: 1.7,
              }}
            >
              <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                كيف يعمل الإبلاغ عبر واتساب؟
              </div>
              <div>1️⃣ أرسل صورة المشكلة أو الحفرة في الشارع.</div>
              <div>2️⃣ شارك الموقع الجغرافي (Location).</div>
              <div>3️⃣ يصلك رقم البلاغ وتقييم الذكاء الاصطناعي وتحديثات الصيانة تلقائيًا.</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
