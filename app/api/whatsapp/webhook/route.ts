import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Webhook verification endpoint for Meta
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// Webhook event receiver
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Direct fallback for your Supabase URL (Supabase URLs are public endpoints)
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://rsqdqvftbslcxuclhqrh.supabase.co";

    // Service key fallback
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseKey) {
      console.error("Missing SUPABASE_SERVICE_ROLE_KEY or ANON KEY in runtime environment.");
      return NextResponse.json({ received: true, db: "missing_key" }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from || "unknown_sender";
      const text = message.text?.body || message.type || "unknown_message";

      const { data, error: dbError } = await supabase.from("hazards").insert([
        {
          sender: from,
          message: text,
          raw_payload: body,
          created_at: new Date().toISOString(),
        },
      ]);

      if (dbError) {
        console.error("Supabase insert error:", dbError.message);
      } else {
        console.log("Successfully inserted hazard record into Supabase");
      }
    }

    return NextResponse.json({ status: "success" }, { status: 200 });
  } catch (error: any) {
    console.error("Unhandled Webhook POST Error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 200 });
  }
}
