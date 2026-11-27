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
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const BUCKET_NAME = 'hazard-images';

interface HazardAnalysis {
  category: string;
  severity: string;
  description: string;
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

async function sendWhatsAppReply(to: string, text: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !to) return;

  const isNumericPhone = /^\d+$/.test(to);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  if (!isNumericPhone) {
    payload.recipient_type = 'individual';
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
        body: JSON.stringify(payload),
      }
    );
  } catch (err) {
    console.error('Failed to send WhatsApp reply:', err);
  }
}

async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!ACCESS_TOKEN || !mediaId) return null;

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      }
    );
    if (!metaRes.ok) return null;

    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    const mimeType = metaData.mime_type || 'image/jpeg';
    if (!mediaUrl) return null;

    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } catch (err) {
    console.error('Error downloading WhatsApp media:', err);
    return null;
  }
}

async function discoverAvailableGeminiModels(): Promise<string[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data?.models || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        typeof m.name === 'string' &&
        m.name.includes('gemini') &&
        !m.name.includes('embedding') &&
        !m.name.includes('imagen') &&
        !m.name.includes('veo')
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => m.name.replace(/^models\//, ''));

    // Prioritize flash models first
    return models.sort((a: string, b: string) => {
      const aFlash = a.includes('flash') ? 0 : 1;
      const bFlash = b.includes('flash') ? 0 : 1;
      return aFlash - bFlash;
    });
  } catch {
    return [];
  }
}

async function callGeminiModel(
  model: string,
  prompt: string,
  base64Image: string,
  mimeType: string
): Promise<{ result: HazardAnalysis | null; error: string | null }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return {
        result: null,
        error: `${model} (${res.status}): ${errText.slice(0, 140)}`,
      };
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return { result: null, error: `${model}: empty response` };
    }

    const cleanJson = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJson) as HazardAnalysis;
    return { result: parsed, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return {
      result: null,
      error: `${model} exception: ${err?.message || 'Unknown'}`,
    };
  }
}

async function analyzeHazardWithGemini(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{ result: HazardAnalysis | null; error: string | null }> {
  if (!GEMINI_API_KEY) {
    return { result: null, error: 'Missing GEMINI_API_KEY' };
  }

  const base64Image = imageBuffer.toString('base64');
  const prompt = `أنت خبير هندسي وميداني لتحليل بلاغات مخاطر الطرق والمرافق العامة.
افحص هذه الصورة بدقة وأرجع النتيجة بصيغة JSON فقط بهذا الشكل الدقيق دون أي نص إضافي:
{
  "category": "اختر التصنيف الأنسب من: حفرة في الطريق، كسر ماسورة مياه، عمود إنارة تالف، تراكم مخلفات، أسلاك كهرباء مكشوفة، هبوط أرضي، أخرى",
  "severity": "اختر درجة الخطورة من: منخفضة، متوسطة، عالية، حرجة",
  "description": "وصف فني مختصر ودقيق باللغة العربية في جملة واحدة لما يظهر في الصورة"
}`;

  const primaryModels = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
    'gemini-3.1-pro-preview',
  ];

  const errors: string[] = [];

  for (const model of primaryModels) {
    const attempt = await callGeminiModel(model, prompt, base64Image, mimeType);
    if (attempt.result) return { result: attempt.result, error: null };
    if (attempt.error) errors.push(attempt.error);
  }

  // Auto-discover available models for this API key if primary list fails
  const discovered = await discoverAvailableGeminiModels();
  for (const model of discovered) {
    if (primaryModels.includes(model)) continue;
    const attempt = await callGeminiModel(model, prompt, base64Image, mimeType);
    if (attempt.result) return { result: attempt.result, error: null };
    if (attempt.error) errors.push(attempt.error);
  }

  return { result: null, error: errors.slice(0, 4).join(' | ') };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const message = value?.messages?.[0];
    if (!message) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const contact = value?.contacts?.[0];
    const sender =
      message.from ||
      message.from_user_id ||
      contact?.wa_id ||
      contact?.user_id ||
      'unknown';

    const msgId = message.id || `wa_${Date.now()}`;
    const msgType = message.type;

    // 1. حالة استلام صورة: نحجز السجل في قاعدة البيانات فورًا لمنع السباق مع رسالة الموقع
    if (msgType === 'image' && message.image?.id) {
      const caption = message.image.caption || '';

      const { data: placeholder } = await supabase
        .from('hazards')
        .insert({
          whatsapp_message_id: msgId,
          sender,
          message: caption || 'صورة بلاغ عبر واتساب',
          raw_payload: body,
          media_status: 'processing',
          status: 'جديد',
        })
        .select('id')
        .single();

      const reportId = placeholder?.id;

      const media = await downloadWhatsAppMedia(message.image.id);
      if (!media) {
        await sendWhatsAppReply(
          sender,
          '⚠️ تعذر تحميل الصورة، يرجى إعادة إرسالها مرة أخرى.'
        );
        return NextResponse.json({ status: 'media_failed' }, { status: 200 });
      }

      const ext = media.mimeType.split('/')[1]?.split(';')[0] || 'jpg';
      const filePath = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

      const [uploadRes, aiRes] = await Promise.all([
        supabase.storage
          .from(BUCKET_NAME)
          .upload(filePath, media.buffer, {
            contentType: media.mimeType,
            upsert: true,
          }),
        analyzeHazardWithGemini(media.buffer, media.mimeType),
      ]);

      const { data: pubUrl } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      const category = aiRes.result?.category || 'أخرى';
      const severity = aiRes.result?.severity || 'متوسطة';
      const description =
        aiRes.result?.description || caption || 'بلاغ مصور عبر واتساب';

      if (reportId) {
        const { data: updatedRow } = await supabase
          .from('hazards')
          .update({
            media_status: uploadRes.error ? 'failed' : 'uploaded',
            image_url: pubUrl?.publicUrl || null,
            hazard_category: category,
            severity,
            ai_description: description,
            processing_error: aiRes.error,
          })
          .eq('id', reportId)
          .select('id, latitude')
          .single();

        const hasLocationAlready =
          updatedRow?.latitude !== null && updatedRow?.latitude !== undefined;

        await sendWhatsAppReply(
          sender,
          `✅ تم استلام الصورة وتحليلها بنجاح #${reportId}\n` +
            `🔍 *التصنيف:* ${category}\n` +
            `⚠️ *درجة الخطورة:* ${severity}\n` +
            `📝 *التقييم:* ${description}\n\n` +
            (hasLocationAlready
              ? `📍 *تم ربط موقعك الجغرافي بالبلاغ تلقائيًا!* سنوافيك بالتحديثات أولًا بأول.`
              : `📍 *الخطوة الأخيرة:* من فضلك أرسل الآن **الموقع الجغرافي (Location)** ليتم توجيه فريق الصيانة فورًا.`)
        );
      }

      return NextResponse.json({ status: 'image_processed' }, { status: 200 });
    }

    // 2. حالة استلام موقع جغرافي (Location)
    if (msgType === 'location' && message.location) {
      const { latitude, longitude, name, address } = message.location;
      const locationName = name || address || null;

      const { data: recentHazard } = await supabase
        .from('hazards')
        .select('id')
        .eq('sender', sender)
        .is('latitude', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentHazard) {
        await supabase
          .from('hazards')
          .update({
            latitude,
            longitude,
            location_name: locationName,
          })
          .eq('id', recentHazard.id);

        await sendWhatsAppReply(
          sender,
          `📍 تم ربط الموقع الجغرافي بالبلاغ رقم *#${recentHazard.id}* بنجاح!\n` +
            `شكرًا لمساهمتك في تحسين الطرق، سنوافيك هنا فور بدء الصيانة وإغلاق البلاغ.`
        );
      } else {
        await sendWhatsAppReply(
          sender,
          `📍 تم استلام موقعك الجغرافي.\nمن فضلك أرسل الآن **صورة واضحة للمشكلة** ليقوم النظام بتحليلها وتسجيل البلاغ.`
        );
      }

      return NextResponse.json({ status: 'location_processed' }, { status: 200 });
    }

    // 3. حالة استلام رسالة نصية
    if (msgType === 'text') {
      await sendWhatsAppReply(
        sender,
        `أهلاً بك في منصة *Salka (سالكة)* 🛣️\n` +
          `للإبلاغ عن أي خطر في الطريق أو المرافق:\n` +
          `1️⃣ التقط وأرسل **صورة المشكلة**.\n` +
          `2️⃣ أرسل **الموقع الجغرافي (Location)**.\n\n` +
          `أو يمكنك الإبلاغ مباشرة عبر موقعنا:\nhttps://salka-app-seven.vercel.app`
      );
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (err) {
    console.error('Webhook POST error:', err);
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}
