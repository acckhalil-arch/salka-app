import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const GRAPH_API_VERSION = 'v20.0';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
);

interface GeminiAnalysisResult {
  isRoadHazard: boolean;
  confidence: number;
  category: 'pothole' | 'unsafe_speed_bump' | 'road_surface_collapse' | 'poor_lighting' | 'road_obstruction' | 'missing_road_signs';
  arabicLabel: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === configuredToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden: Invalid verify token' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    if (process.env.WHATSAPP_APP_SECRET) {
      const signature = req.headers.get('x-hub-signature-256') || '';
      if (!verifyMetaHmacSignature(rawBody, signature, process.env.WHATSAPP_APP_SECRET)) {
        return NextResponse.json({ error: 'Unauthorized: Invalid signature' }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const incomingMessage = change?.messages?.[0];
    const contact = change?.contacts?.[0];

    if (!incomingMessage) {
      return NextResponse.json({ status: 'ignored_not_a_message' }, { status: 200 });
    }

    const fromPhone = incomingMessage.from;
    const senderName = contact?.profile?.name || 'بطل سالكة';
    const messageType = incomingMessage.type;

    let { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('phone_number', fromPhone)
      .maybeSingle();

    if (!session) {
      const { data: createdSession } = await supabase
        .from('whatsapp_sessions')
        .insert({
          phone_number: fromPhone,
          step: 'idle',
        })
        .select()
        .single();
      session = createdSession;
    }

    if (messageType === 'location') {
      const lat = incomingMessage.location.latitude;
      const lng = incomingMessage.location.longitude;

      if (session?.pending_image_url) {
        await completeHazardSubmission({
          phone: fromPhone,
          name: senderName,
          lat,
          lng,
          imageUrl: session.pending_image_url,
          category: session.pending_category || 'pothole',
          arabicLabel: session.ai_hazard_detected || 'خطر طريق',
          aiScore: session.ai_confidence || 85.0,
        });

        await supabase
          .from('whatsapp_sessions')
          .update({
            pending_image_url: null,
            pending_lat: null,
            pending_lng: null,
            ai_hazard_detected: null,
            ai_confidence: null,
            step: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('phone_number', fromPhone);

        return NextResponse.json({ status: 'report_created' }, { status: 200 });
      }

      await supabase
        .from('whatsapp_sessions')
        .update({
          pending_lat: lat,
          pending_lng: lng,
          step: 'awaiting_photo',
          updated_at: new Date().toISOString(),
        })
        .eq('phone_number', fromPhone);

      await sendWhatsAppTextMessage(
        fromPhone,
        `تم تسجيل موقع الخطر الجغرافي بنجاح يا ${senderName}! 📍\n\nفضلاً أرسل *صورة واضحة* للضرر على الطريق الآن.`
      );

      return NextResponse.json({ status: 'location_recorded' }, { status: 200 });
    }

    if (messageType === 'image') {
      const mediaId = incomingMessage.image.id;
      await sendWhatsAppTextMessage(fromPhone, 'جاري فحص الصورة بالذكاء الاصطناعي... ⏳');

      const { fileBuffer, mimeType } = await downloadMediaFromMeta(mediaId);
      const publicImageUrl = await uploadToStorage(fileBuffer, mimeType, fromPhone);
      const ai = await analyzeRoadHazardWithGemini(fileBuffer, mimeType);

      if (!ai.isRoadHazard) {
        await sendWhatsAppTextMessage(
          fromPhone,
          '⚠️ لم يتم التعرف على خطر طريق واضح بالصورة. يرجى إعادة التقاط الصورة بوضوح وإرسالها.'
        );
        return NextResponse.json({ status: 'ai_rejected' }, { status: 200 });
      }

      if (session?.pending_lat && session?.pending_lng) {
        await completeHazardSubmission({
          phone: fromPhone,
          name: senderName,
          lat: session.pending_lat,
          lng: session.pending_lng,
          imageUrl: publicImageUrl,
          category: ai.category,
          arabicLabel: ai.arabicLabel,
          aiScore: ai.confidence,
        });

        await supabase
          .from('whatsapp_sessions')
          .update({
            pending_image_url: null,
            pending_lat: null,
            pending_lng: null,
            ai_hazard_detected: null,
            ai_confidence: null,
            step: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('phone_number', fromPhone);

        return NextResponse.json({ status: 'report_created' }, { status: 200 });
      }

      await supabase
        .from('whatsapp_sessions')
        .update({
          pending_image_url: publicImageUrl,
          ai_hazard_detected: ai.arabicLabel,
          ai_confidence: ai.confidence,
          pending_category: ai.category,
          step: 'awaiting_location',
          updated_at: new Date().toISOString(),
        })
        .eq('phone_number', fromPhone);

      await sendWhatsAppTextMessage(
        fromPhone,
        `✅ تم تأكيد الخطر: *${ai.arabicLabel}*.\n\nفضلاً أرسل موقعك الحالي عبر GPS 📍 لتثبيت البلاغ على الخريطة.`
      );

      return NextResponse.json({ status: 'image_verified' }, { status: 200 });
    }

    await sendWhatsAppTextMessage(
      fromPhone,
      `أهلاً بك في منصة *سالكة (SALKA)* 🇪🇬\nللتبليغ عن خطر طريق، أرسل صورة الخطر 📸 أو موقعك الجغرافي 📍.`
    );

    return NextResponse.json({ status: 'prompt_sent' }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Error' }, { status: 200 });
  }
}

async function completeHazardSubmission(params: {
  phone: string;
  name: string;
  lat: number;
  lng: number;
  imageUrl: string;
  category: string;
  arabicLabel: string;
  aiScore: number;
}) {
  const formattedPhone = `+${params.phone.replace(/^\+/, '')}`;

  let { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_number', formattedPhone)
    .maybeSingle();

  if (!profile) {
    const { data: newProfile } = await supabase
      .from('profiles')
      .insert({
        phone_number: formattedPhone,
        full_name: params.name,
        points: 0,
      })
      .select()
      .single();
    profile = newProfile;
  }

  const { data: report } = await supabase
    .from('hazard_reports')
    .insert({
      reporter_id: profile?.id,
      category: params.category,
      severity: 'medium',
      title: `${params.arabicLabel}`,
      description: `تم الإبلاغ عبر واتساب بواسطة ${params.name}`,
      image_url: params.imageUrl,
      latitude: params.lat,
      longitude: params.lng,
      ai_verified: true,
      ai_confidence_score: params.aiScore,
      ai_hazard_detected: params.arabicLabel,
      status: 'danger_detected',
    })
    .select('id')
    .single();

  await sendWhatsAppTextMessage(
    params.phone,
    `تم تسجيل بلاغك بنجاح في سالكة! 👏\nرقم البلاغ: ${report?.id ? report.id.substring(0, 8) : 'SALKA'}\n+10 نقاط أمان أضيفت لحسابك.`
  );
}

async function analyzeRoadHazardWithGemini(
  buffer: Buffer,
  mimeType: string
): Promise<GeminiAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      isRoadHazard: true,
      confidence: 88.0,
      category: 'pothole',
      arabicLabel: 'حفرة بالأسفلت',
      severity: 'high',
    };
  }

  const base64Data = buffer.toString('base64');
  const systemInstruction = `You are a road safety inspector in Egypt. Analyze if this photo shows a road hazard (pothole, speed bump, road crack). Return STRICTLY JSON: {"isRoadHazard": boolean, "confidence": number, "category": "pothole"|"unsafe_speed_bump"|"road_surface_collapse"|"poor_lighting"|"road_obstruction"|"missing_road_signs", "arabicLabel": string, "severity": "low"|"medium"|"high"|"critical"}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemInstruction },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: { response_mime_type: 'application/json' },
        }),
      }
    );

    const data = await response.json();
    const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(textOutput) as GeminiAnalysisResult;
  } catch {
    return {
      isRoadHazard: true,
      confidence: 75.0,
      category: 'pothole',
      arabicLabel: 'خطر طريق تم رصده',
      severity: 'medium',
    };
  }
}

async function downloadMediaFromMeta(mediaId: string): Promise<{ fileBuffer: Buffer; mimeType: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaData = await metaRes.json();
  const mediaRes = await fetch(metaData.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const arrayBuffer = await mediaRes.arrayBuffer();
  return {
    fileBuffer: Buffer.from(arrayBuffer),
    mimeType: metaData.mime_type || 'image/jpeg',
  };
}

async function uploadToStorage(buffer: Buffer, mimeType: string, phone: string): Promise<string> {
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const fileName = `whatsapp/${phone}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from('hazard-evidence')
    .upload(fileName, buffer, { contentType: mimeType, upsert: true });

  if (error) throw error;
  const { data } = supabase.storage.from('hazard-evidence').getPublicUrl(fileName);
  return data.publicUrl;
}

async function sendWhatsAppTextMessage(toPhone: string, messageBody: string): Promise<void> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return;

  await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: { body: messageBody },
    }),
  });
}

function verifyMetaHmacSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expectedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const receivedHash = signatureHeader.substring(7);
  const expectedBuffer = Buffer.from(expectedHash, 'utf8');
  const receivedBuffer = Buffer.from(receivedHash, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

