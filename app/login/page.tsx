'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (session) {
        router.replace('/dashboard');
      } else {
        setCheckingSession(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg('بيانات الدخول غير صحيحة. يرجى التحقق من البريد الإلكتروني وكلمة المرور.');
        setLoading(false);
        return;
      }

      if (data.session) {
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('is_active')
          .eq('id', data.session.user.id)
          .single();

        if (profileError || !profile?.is_active) {
          await supabase.auth.signOut();
          setErrorMsg('هذا الحساب غير مفعل حالياً. يرجى التواصل مع مدير النظام.');
          setLoading(false);
          return;
        }

        router.replace('/dashboard');
      }
    } catch {
      setErrorMsg('حدث خطأ غير متوقع أثناء الاتصال بالخادم.');
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div dir="rtl" style={styles.container}>
        <div style={{ color: '#cbd5e1', fontSize: '16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          جاري التحقق من الجلسة...
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.badge}>منصة سالكة للعمليات البلدية الذكية</div>
          <h1 style={styles.title}>تسجيل دخول غرفة العمليات</h1>
          <p style={styles.subtitle}>الوصول مقصور على الكوادر المصرح لها فقط</p>
        </div>

        {errorMsg && (
          <div style={styles.errorBox}>
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="email">
              البريد الإلكتروني الوظيفي
            </label>
            <input
              id="email"
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@municipality.gov"
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label} htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              required
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={styles.input}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.button,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'جاري التحقق والدخول...' : 'تسجيل الدخول'}
          </button>
        </form>

        <div style={styles.footer}>
          <span>نظام محمي بتشفير الصلاحيات المتعددة (RBAC)</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#1e293b',
    borderRadius: '16px',
    border: '1px solid #334155',
    padding: '32px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  badge: {
    display: 'inline-block',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    padding: '4px 12px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    marginBottom: '12px',
  },
  title: {
    color: '#f8fafc',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 8px 0',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '14px',
    margin: 0,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    color: '#fca5a5',
    padding: '12px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 600,
  },
  input: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#f8fafc',
    fontSize: '15px',
    outline: 'none',
    textAlign: 'left',
  },
  button: {
    marginTop: '6px',
    backgroundColor: '#10b981',
    color: '#064e3b',
    fontWeight: 700,
    fontSize: '15px',
    padding: '13px',
    borderRadius: '10px',
    border: 'none',
    transition: 'background-color 0.2s',
  },
  footer: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #334155',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '12px',
  },
};
