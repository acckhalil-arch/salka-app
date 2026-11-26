import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

async function processWhatsAppImage(supabase: SupabaseClient, mediaId: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { imageUrl: null, status: "failed", error: "Missing WHATSAPP_ACCESS_TOKEN" };

  try {
    const { data: existing } = await supabase
      .from("hazards")
      .select("image_url")
      .eq("whatsapp_media_id", mediaId)
      .maybeSingle();

    if (existing?.image_url) return { imageUrl: existing.image_url, status: "uploaded", error: null };

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) throw new Error(`Meta API ${metaRes.status}: ${await metaRes.text()}`);

    const metaData = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaData.url) throw new Error("No media URL returned by Meta");

    const imgRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!imgRes.ok) throw new Error(`Image download ${imgRes.status}`);

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const mimeType = metaData.mime_type || "image/jpeg";
    const ext = mimeType.split("/")[1]?.split(";")[0] || "jpg";
    const filePath = `${new Date().toISOString().slice(0, 10)}/${mediaId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("hazard-images")
      .upload(filePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw new Error(`Storage error: ${uploadError.message}`);

    const { data: pub } = supabase.storage.from("hazard-images").getPublicUrl(filePath);
    return { imageUrl: pub.publicUrl, status: "uploaded", error: null };
  } catch (err: any) {
    return { imageUrl: null, status: "failed", error: err?.message || String(err) };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "Salka_verify_2026";

  if (mode === "subscribe" && (token === verifyToken || token === "Salka_verify_2026")) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rsqdqvftbslcxuclciqh.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseKey) return NextResponse.json({ received: true, db: "missing_key" }, { status: 200 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from || "unknown_sender";
      const whatsappMessageId = message.id || null;
      const msgType = message.type || "unknown";

      if (whatsappMessageId) {
        const { data: dup } = await supabase
          .from("hazards")
          .select("id")
          .eq("whatsapp_message_id", whatsappMessageId)
          .maybeSingle();
        if (dup) return NextResponse.json({ status: "duplicate_ignored" }, { status: 200 });
      }

      let text = message.text?.body || msgType;
      let latitude: number | null = null;
      let longitude: number | null = null;
      let locationName: string | null = null;
      let imageUrl: string | null = null;
      let whatsappMediaId: string | null = null;
      let mediaStatus = "none";
      let processingError: string | null = null;

      if (msgType === "location" && message.location) {
        latitude = message.location.latitude ?? null;
        longitude = message.location.longitude ?? null;
        locationName = [message.location.name, message.location.address].filter(Boolean).join(" - ") || null;
        text = locationName ? `Location: ${locationName} (${latitude}, ${longitude})` : `Location shared (${latitude}, ${longitude})`;
      }

      if (msgType === "image" && message.image?.id) {
        whatsappMediaId = message.image.id;
        text = message.image.caption || "Image hazard report";
        const res = await processWhatsAppImage(supabase, whatsappMediaId!);
        imageUrl = res.imageUrl;
        mediaStatus = res.status;
        processingError = res.error;
      }

      const { error: dbError } = await supabase.from("hazards").insert([{
        sender: from,
        message: text,
        raw_payload: body,
        created_at: new Date().toISOString(),
        whatsapp_message_id: whatsappMessageId,
        latitude,
        longitude,
        location_name: locationName,
        image_url: imageUrl,
        whatsapp_media_id: whatsappMediaId,
        media_status: mediaStatus,
        processing_error: processingError,
      }]);

      if (dbError) console.error("Supabase insert error:", dbError.message);
    }

    return NextResponse.json({ status: "success" }, { status: 200 });
  } catch (error: any) {
    console.error("Unhandled Webhook POST Error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 200 });
  }
}
