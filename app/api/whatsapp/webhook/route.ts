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

const VERIFY_TOKEN = (process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
const ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const BUCKET_NAME = 'hazard-images';

// دالة إرسال رد تلقائي عبر WhatsApp Cloud API
async function sendWhatsAppReply(to: string, text: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('Missing ACCESS_TOKEN or PHONE_NUMBER_ID for WhatsApp reply');
    return;
  }

  try {
    const res = await fetch(
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
          text: { body: text },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('WhatsApp reply failed:', res.status, errText);
    }
  } catch (err) {
    console.error('WhatsApp reply network error:', err);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ status: 'no_messages' }, { status: 200 });
    }

    for (const msg of messages) {
      const whatsappMessageId = msg.id;
      const sender = msg.from;
      const type = msg.type;

      // نافذة زمنية 5 دقائق لدمج الصورة والموقع لنفس المرسل
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      if (type === 'image') {
        const whatsappMediaId = msg.image?.id || null;
        const captionText = msg.image?.caption || 'Image hazard report';
        let mediaStatus = 'none';
        let imageUrl: string | null = null;
        let processingError: string | null = null;

        if (!ACCESS_TOKEN) {
          mediaStatus = 'failed';
          processingError = 'Missing WHATSAPP_ACCESS_TOKEN';
        } else if (whatsappMediaId) {
          try {
            const metaRes = await fetch(
              `https://graph.facebook.com/v21.0/${whatsappMediaId}`,
              { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
            );
            if (!metaRes.ok) {
              throw new Error(`Meta API ${metaRes.status}: ${await metaRes.text()}`);
            }
            const metaData = await metaRes.json();
            const mimeType = metaData.mime_type || 'image/jpeg';
            const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';

            const fileRes = await fetch(metaData.url, {
              headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
            });
            if (!fileRes.ok) {
              throw new Error(`Media download failed: ${fileRes.status}`);
            }

            const buffer = Buffer.from(await fileRes.arrayBuffer());
            const filePath = `${whatsappMessageId}.${ext}`;

            const { error: uploadError } = await supabase.storage
              .from(BUCKET_NAME)
              .upload(filePath, buffer, { contentType: mimeType, upsert: true });

            if (uploadError) {
              throw new Error(`Supabase Storage error: ${uploadError.message}`);
            }

            const { data: publicUrlData } = supabase.storage
              .from(BUCKET_NAME)
              .getPublicUrl(filePath);

            imageUrl = publicUrlData.publicUrl;
            mediaStatus = 'uploaded';
          } catch (err: any) {
            mediaStatus = 'failed';
            processingError = err?.message || 'Unknown media error';
          }
        }

        // البحث عن بلاغ حديث لنفس المرسل يحتوي على موقع وينتظر صورة
        const { data: pendingLocationReport } = await supabase
          .from('hazards')
          .select('id, message')
          .eq('sender', sender)
          .is('image_url', null)
          .not('latitude', 'is', null)
          .gte('created_at', fiveMinutesAgo)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pendingLocationReport) {
          const updatedMsg =
            captionText !== 'Image hazard report'
              ? `${captionText} | ${pendingLocationReport.message}`
              : pendingLocationReport.message;

          await supabase
            .from('hazards')
            .update({
              message: updatedMsg,
              whatsapp_media_id: whatsappMediaId,
              media_status: mediaStatus,
              image_url: imageUrl,
              processing_error: processingError,
            })
            .eq('id', pendingLocationReport.id);

          await sendWhatsAppReply(
            sender,
            `✅ شكرًا لك! تم دمج الصورة مع الموقع واكتمال بلاغك بنجاح (رقم البلاغ #${pendingLocationReport.id}).`
          );
        } else {
          const { data: insertedRow } = await supabase
            .from('hazards')
            .insert({
              whatsapp_message_id: whatsappMessageId,
              sender,
              message: captionText,
              raw_payload: msg,
              whatsapp_media_id: whatsappMediaId,
              media_status: mediaStatus,
              image_url: imageUrl,
              processing_error: processingError,
            })
            .select('id')
            .single();

          const reportId = insertedRow?.id || '';
          await sendWhatsAppReply(
            sender,
            `📸 تم استلام صورة البلاغ بنجاح (رقم #${reportId}).\n📍 من فضلك أرسل الموقع الجغرافي (Location) الآن لإتمام البلاغ.`
          );
        }
      } else if (type === 'location') {
        const latitude = msg.location?.latitude ?? null;
        const longitude = msg.location?.longitude ?? null;
        const locationName = msg.location?.name || msg.location?.address || null;
        const locText = locationName
          ? `Location: ${locationName} (${latitude}, ${longitude})`
          : `Location shared (${latitude}, ${longitude})`;

        // البحث عن بلاغ حديث لنفس المرسل يحتوي على صورة وينتظر موقعًا
        const { data: pendingImageReport } = await supabase
          .from('hazards')
          .select('id, message')
          .eq('sender', sender)
          .is('latitude', null)
          .not('image_url', 'is', null)
          .gte('created_at', fiveMinutesAgo)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pendingImageReport) {
          const mergedMsg =
            pendingImageReport.message &&
            pendingImageReport.message !== 'Image hazard report'
              ? `${pendingImageReport.message} | ${locText}`
              : locText;

          await supabase
            .from('hazards')
            .update({
              message: mergedMsg,
              latitude,
              longitude,
              location_name: locationName,
            })
            .eq('id', pendingImageReport.id);

          await sendWhatsAppReply(
            sender,
            `✅ شكرًا لك! تم تسجيل بلاغك بالكامل (رقم البلاغ #${pendingImageReport.id}) مرفقًا بالصورة والموقع الجغرافي.`
          );
        } else {
          const { data: insertedRow } = await supabase
            .from('hazards')
            .insert({
              whatsapp_message_id: whatsappMessageId,
              sender,
              message: locText,
              raw_payload: msg,
              latitude,
              longitude,
              location_name: locationName,
              media_status: 'none',
            })
            .select('id')
            .single();

          const reportId = insertedRow?.id || '';
          await sendWhatsAppReply(
            sender,
            `📍 تم استلام الموقع الجغرافي بنجاح (رقم #${reportId}).\n📸 من فضلك أرسل صورة للمشكلة الآن لإتمام البلاغ.`
          );
        }
      } else if (type === 'text') {
        const messageText = msg.text?.body || '';
        await supabase.from('hazards').insert({
          whatsapp_message_id: whatsappMessageId,
          sender,
          message: messageText,
          raw_payload: msg,
          media_status: 'none',
        });

        await sendWhatsAppReply(
          sender,
          `👋 أهلًا بك في خدمة البلاغات (Salka).\nلإرسال بلاغ جديد، أرسل **صورة** المشكلة متبوعة بـ **الموقع الجغرافي (Location)**.`
        );
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error: any) {
    console.error('Webhook POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
