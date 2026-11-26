import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const GRAPH_API_VERSION = "v21.0";

// Helper: Fetch media URL from Meta Graph API v21.0, download binary, and upload to Supabase Storage
async function processWhatsAppImage(
  supabase: SupabaseClient,
  mediaId: string
): Promise<{
  imageUrl: string | null;
  status: "uploaded" | "failed";
  error: string | null;
}> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    return {
      imageUrl: null,
      status: "failed",
      error: "Missing WHATSAPP_ACCESS_TOKEN in Vercel environment variables",
    };
  }

  try {
    // 1. Prevent duplicate processing if this mediaId was already uploaded
    const { data: existing } = await supabase
      .from("hazards")
      .select("image_url")
      .eq("whatsapp_media_id", mediaId)
      .maybeSingle();

    if (existing?.image_url) {
      return { imageUrl: existing.image_url, status: "uploaded", error: null };
    }

    // 2. Request temporary download URL from Meta Graph API v21.0
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      throw new Error(`Meta Graph API error (${metaRes.status}): ${errText}`);
    }

    const metaData = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
    };

    if (!metaData.url) {
      throw new Error("Meta Graph API did not return a media download URL");
    }

    // 3. Download image binary from Meta's media URL
    const imageRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!imageRes.ok) {
      throw new Error(`Image binary download failed (${imageRes.status})`);
    }

    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = metaData.mime_type || "image/jpeg";
    const ext = mimeType.split("/")[1]?.split(";")[0] || "jpg";
    const dateFolder = new Date().toISOString().slice(0, 10);
    const filePath = `${dateFolder}/${mediaId}.${ext}`;

    // 4. Upload to Supabase Storage bucket 'hazard-images'
    const { error: uploadError } = await supabase.storage
      .from("hazard-images")
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
    }

    // 5. Get public URL for dashboard rendering
    const { data: publicUrlData } = supabase.storage
      .from("hazard-images")
      .getPublicUrl(filePath);

    return {
      imageUrl: publicUrlData.publicUrl,
      status: "uploaded",
      error: null,
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[Salka Media Error] mediaId=${mediaId}:`, errMsg);
    return {
      imageUrl: null,
      status: "failed",
      error: errMsg,
    };
  }
}

// Webhook verification endpoint for Meta
export async function GET(req: Request) {
  const {
