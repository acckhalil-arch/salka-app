import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ''
).trim();

const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

const supabase = createClient(supabaseUrl, supabaseKey);

const ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

async function notifyCitizenOnWhatsApp(
  to: string,
  reportId: number,
  category: string | null,
  newStatus: string
) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !to) return;

  let statusMessage = '';
  if (newStatus === 'قيد المعالجة') {
    statusMessage = `🛠️ تحديث بخصوص بلاغك (رقم #${reportId}${
      category ? ` - ${category}` : ''
    }):\nتم توجيه فريق الصيانة المختص وجاري العمل على حل المشكلة حاليًا.`;
  } else if (newStatus === 'تم الحل') {
    statusMessage = `✅ بشرى سارة! تم الانتهاء من حل بلاغك (رقم #${reportId}${
      category ? ` - ${category}` : ''
    }) بنجاح.\nشكرًا لمساهمتك الإيجابية في تحسين مدينتنا مع خدمة (Salka)!`;
  } else {
    return;
  }

  try {
    await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: statusMessage },
        }),
      }
    );
  } catch (err) {
    console.error('Failed to send status notification:', err);
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('hazards')
      .select(
        'id, created_at, sender, message, image_url, latitude, longitude, location_name, hazard_category, severity, ai_description, status, media_status'
      )
      .not('image_url', 'is', null)
      .order('id', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ hazards: data || [] }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !status) {
      return NextResponse.json({ error: 'Missing id or status' }, { status: 400 });
    }

    const { data: updatedHazard, error } = await supabase
      .from('hazards')
      .update({ status })
      .eq('id', id)
      .select('id, sender, hazard_category')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (updatedHazard?.sender) {
      await notifyCitizenOnWhatsApp(
        updatedHazard.sender,
        updatedHazard.id,
        updatedHazard.hazard_category,
        status
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
