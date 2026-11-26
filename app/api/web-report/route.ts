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
const BUCKET_NAME = 'hazard-images';

interface HazardAnalysis {
  category: string;
  severity: string;
  description: string;
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
    const phone = (formData.get('phone') as string | null)?.trim() || 'Web-Portal';

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

    const messageSummary = notes
      ? `بلاغ ويب: ${notes} (${latitude}, ${longitude})`
      : `بلاغ مباشر من الموقع (${latitude}, ${longitude})`;

    const { data: insertedRow, error: insertError } = await supabase
      .from('hazards')
      .insert({
        whatsapp_message_id: uniqueId,
        sender: phone,
        message: messageSummary,
        raw_payload: { source: 'web_portal', notes, phone },
        media_status: 'uploaded',
        image_url: imageUrl,
        latitude,
        longitude,
        hazard_category: aiResult?.category || 'أخرى',
        severity: aiResult?.severity || 'متوسطة',
        ai_description: aiResult?.description || notes || 'بلاغ وارد عبر الموقع الإلكتروني',
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

    return NextResponse.json(
      {
        success: true,
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
