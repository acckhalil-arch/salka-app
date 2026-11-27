import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  // Create a client scoped to the user's JWT so RLS "Users can view own profile" works reliably
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: profile } = await supabaseUser
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) {
    return { user, profile: null, blocked: true };
  }

  return {
    user,
    blocked: false,
    profile: profile || {
      id: user.id,
      email: user.email || '',
      full_name: user.email?.split('@')[0] || 'مستخدم النظام',
      role: 'viewer',
      department: 'العمليات',
      is_active: true,
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'غير مصرح بالدخول' }, { status: 401 });
  }
  if (auth.blocked) {
    return NextResponse.json({ error: 'الحساب موقوف' }, { status: 403 });
  }

  const { data: hazards, error } = await supabaseAdmin
    .from('hazards')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    hazards: hazards || [],
    currentUser: auth.profile,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth || auth.blocked || !auth.profile) {
    return NextResponse.json({ error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  const role = auth.profile.role;
  if (!['operator', 'supervisor', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'صلاحيتك الحالية (مراقب) لا تسمح بالتعديل' }, { status: 403 });
  }

  const body = await req.json();
  const { id, status, is_escalated, assigned_to } = body;

  if (!id) {
    return NextResponse.json({ error: 'معرف البلاغ مطلوب' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;

  if (is_escalated !== undefined) {
    if (!['supervisor', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'التصعيد متاح للمشرفين ومديري النظام فقط' }, { status: 403 });
    }
    updates.is_escalated = is_escalated;
  }

  if (assigned_to !== undefined) {
    if (!['supervisor', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'إسناد البلاغات متاح للمشرفين ومديري النظام فقط' }, { status: 403 });
    }
    updates.assigned_to = assigned_to;
  }

  const { data, error } = await supabaseAdmin
    .from('hazards')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hazard: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth || auth.blocked || !auth.profile) {
    return NextResponse.json({ error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  if (auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'حذف البلاغات متاح لمدير النظام فقط' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'معرف البلاغ مطلوب' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('hazards')
    .delete()
    .eq('id', Number(id));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deletedId: Number(id) });
}
