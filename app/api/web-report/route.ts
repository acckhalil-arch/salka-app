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

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const BUCKET_NAME = 'hazard-images';

interface HazardAnalysis {
  category: string;
  severity: string;
  description: string;
}

// تحويل الرقم المصري أو المحلي إلى صيغة واتساب الدولية (مثلاً 010... -> 2010...)
function normalizeWhatsAppPhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return null;

  // رقم مصري يبدأ بـ 01 وطوله 11 رقم
  if (digits.startsWith('01') && digits.length === 11) {
    return `2${digits}`;
  }
  // رقم مصري بدون صفر البداية (10 أرقام)
  if (digits.startsWith('1') && digits.length === 10) {
    return `20${digits}`;
  }
  // رقم بصيغة دولية جاهزة
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}

async function sendWebReportWhatsAppConfirmation(
  toPhone: string,
  reportId: number,
  category: string,
  severity: string,
  description: string
): Promise<boolean> {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !toPhone) return false;

  const messageText =
    `✅ أهلاً بك في منصة *Salka (سالكة)*!\n` +
    `تم استلام بلاغك المُسجّل عبر الموقع الإلكتروني بنجاح.\n\n` +
    `📌 *رقم البلاغ:* #${reportId}\n` +
    `🔍 *التصنيف:* ${category}\n` +
    `⚠️ *درجة الخطورة:* ${severity}\n` +
    `📝 *التقييم الفني:* ${description}\n\n` +
    `سنوافيك هنا بالتحديثات أولاً بأول فور تحرك فريق الصيانة وحتى إغلاق البلاغ.`;

  try {
    // 1. محاولة إرسال رسالة نصية مباشرة
    const textRes = await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'text',
          text: { body: messageText },
        }),
      }
    );

    if (textRes.ok) {
      return true;
    }

    // 2. إذا لم يكن هناك محادثة مفتوحة خلال 24 ساعة، أرسل قالب الترحيب المعتمد لفتح النافذة
    const templateRes = await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'template',
          template: {
            name: 'hello_world',
            language: { code: 'en_US' },
          },
        }),
      }
    );

    return templateRes.ok;
  } catch (err) {
    console.error('WhatsApp confirmation error:', err);
    return false;
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

  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash-lite',
  ];

  let lastError = 'Unknown Gemini error';

  for (const model of modelsToTry) {
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
        lastError = `${model} (${res.status}): ${errText.slice(0, 180)}`;
        if (res.status === 503 || res.status === 429 || res.status === 404) {
          continue;
        }
        return { result: null, error: lastError };
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        lastError = `${model}: Empty response`;
        continue;
      }

      const cleanJson = rawText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson) as HazardAnalysis;
      return { result: parsed, error: null };
    } catch (err: any) {
      lastError = `${model} exception: ${err?.message || 'Unknown'}`;
    }
  }

  return { result: null, error: lastError };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;
    const latRaw = formData.get('latitude') as string | null;
    const lngRaw = formData.get('longitude') as string | null;
    const notes = (formData.get('notes') as string | null)?.trim() || '';
    const rawPhone = (formData.get('phone') as string | null)?.trim() || '';

    if (!file) {
      return NextResponse.json(
        { error: 'يرجى اختيار أو التقاط صورة للمشكلة أولًا.' },
        { status: 400 }
      );
    }

    const latitude = latRaw ? parseFloat(latRaw) : null;
    const longitude = lngRaw ? parseFloat(lngRaw) : null;

    if (
      latitude === null ||
      longitude === null ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      return NextResponse.json(
        { error: 'يرجى تحديد الموقع الجغرافي (GPS) لإتمام البلاغ.' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
    const senderValue = normalizedPhone || 'Web-Portal';

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'image/jpeg';
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
    const uniqueId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filePath = `${uniqueId}.${ext}`;

    const [uploadOutcome, analysisOutcome] = await Promise.all([
      supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, buffer, { contentType: mimeType, upsert: true }),
      analyzeHazardWithGemini(buffer, mimeType),
    ]);

    if (uploadOutcome.error) {
      return NextResponse.json(
        { error: `فشل رفع الصورة: ${uploadOutcome.error.message}` },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    const imageUrl = publicUrlData.publicUrl;
    const aiResult = analysisOutcome.result;
    const finalCategory = aiResult?.category || 'أخرى';
    const finalSeverity = aiResult?.severity || 'متوسطة';
    const finalDescription =
      aiResult?.description || notes || 'بلاغ وارد عبر الموقع الإلكتروني';

    const messageSummary = notes
      ? `بلاغ ويب: ${notes} (${latitude}, ${longitude})`
      : `بلاغ مباشر من الموقع (${latitude}, ${longitude})`;

    const { data: insertedRow, error: insertError } = await supabase
      .from('hazards')
      .insert({
        whatsapp_message_id: uniqueId,
        sender: senderValue,
        message: messageSummary,
        raw_payload: {
          source: 'web_portal',
          notes,
          raw_phone: rawPhone,
          normalized_phone: normalizedPhone,
        },
        media_status: 'uploaded',
        image_url: imageUrl,
        latitude,
        longitude,
        hazard_category: finalCategory,
        severity: finalSeverity,
        ai_description: finalDescription,
        processing_error: analysisOutcome.error,
        status: 'جديد',
      })
      .select('id, hazard_category, severity, ai_description')
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: `فشل حفظ البلاغ: ${insertError.message}` },
        { status: 500 }
      );
    }

    // إرسال رسالة تأكيد على واتساب إذا أدخل المواطن رقم هاتفه
    let whatsappNotified = false;
    if (normalizedPhone && insertedRow) {
      whatsappNotified = await sendWebReportWhatsAppConfirmation(
        normalizedPhone,
        insertedRow.id,
        finalCategory,
        finalSeverity,
        finalDescription
      );
    }

    return NextResponse.json(
      {
        success: true,
        whatsappNotified,
        hasPhone: Boolean(normalizedPhone),
        report: insertedRow,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
