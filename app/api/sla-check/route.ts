import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST() {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('hazards')
    .update({ is_escalated: true })
    .neq('status', 'تم الحل')
    .eq('is_escalated', false)
    .lt('due_at', nowIso)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    escalatedCount: data?.length || 0,
    escalatedIds: (data || []).map((r) => r.id),
  });
}
