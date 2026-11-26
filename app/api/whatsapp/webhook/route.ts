import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
);

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
const BUCKET_NAME = 'hazard-images';

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
      const senderPhone = msg.from;
      const type = msg.type;

      let messageText = '';
      let latitude: number | null = null;
      let longitude: number | null = null;
      let locationName: string | null = null;
      let mediaStatus = 'none';
      let imageUrl: string | null = null;
      let processingError: string | null = null;

      if (type === 'text') {
        messageText = msg.text?.body || '';
      } else if (type === 'location') {
        latitude = msg.location?.latitude ?? null;
        longitude = msg.location?.longitude ?? null;
        locationName = msg.location?.name || msg.location?.address || null;
        messageText = `Location shared (${latitude}, ${longitude})`;
      } else if (type === 'image') {
        const mediaId = msg.image?.id;
        messageText = msg.image?.caption || 'Image hazard report';

        if (!ACCESS_TOKEN) {
          mediaStatus = 'failed';
          processingError = 'Missing WHATSAPP_ACCESS_TOKEN environment variable';
        } else if (mediaId) {
          try {
            // Step 1: Retrieve temporary media download URL from Meta Graph API
            const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
              },
            });

            if (!metaRes.ok) {
              const errText = await metaRes.text();
              throw new Error(`Meta API ${metaRes.status}: ${errText}`);
            }

            const metaData = await metaRes.json();
            const downloadUrl = metaData.url;
            const mimeType = metaData.mime_type || 'image/jpeg';
            const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';

            // Step 2: Download binary image file from Meta
            const fileRes = await fetch(downloadUrl, {
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
              },
            });

            if (!fileRes.ok) {
              throw new Error(`Media download failed: ${fileRes.status}`);
            }

            const arrayBuffer = await fileRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const filePath = `${whatsappMessageId}.${ext}`;

            // Step 3: Upload binary image to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from(BUCKET_NAME)
              .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
              });

            if (uploadError) {
              throw new Error(`Supabase Storage error: ${uploadError.message}`);
            }

            // Step 4: Get public URL
            const { data: publicUrlData } = supabase.storage
              .from(BUCKET_NAME)
              .getPublicUrl(filePath);

            imageUrl = publicUrlData.publicUrl;
            mediaStatus = 'uploaded';
          } catch (err: any) {
            mediaStatus = 'failed';
            processingError = err?.message || 'Unknown media processing error';
          }
        }
      } else {
        messageText = `Unsupported message type: ${type}`;
      }

      await supabase.from('hazards').insert({
        whatsapp_message_id: whatsappMessageId,
        sender_phone: senderPhone,
        message: messageText,
        latitude,
        longitude,
        location_name: locationName,
        media_status: mediaStatus,
        image_url: imageUrl,
        processing_error: processingError,
      });
