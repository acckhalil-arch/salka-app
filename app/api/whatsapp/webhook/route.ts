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

    // Check environment variables inside POST to prevent module load crash
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "";

    // If variables are still missing, log diagnostics and return 200 to keep Meta happy
    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase credentials missing at runtime:", {
        hasUrl: Boolean(supabaseUrl),
        hasKey: Boolean(supabaseKey),
        foundUrlName: process.env.NEXT_PUBLIC_SUPABASE_URL ? "NEXT_PUBLIC_SUPABASE_URL" : process.env.SUPABASE_URL ? "SUPABASE_URL" : "NONE",
      });
      return NextResponse.json({ received: true, db: "skipped_missing_env" }, { status: 200 });
    }

    // Initialize Supabase safely inside the function
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse incoming WhatsApp message
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from; // Sender WhatsApp number
      const text = message.text?.body || message.type; // Message content

      // Insert hazard report into Supabase
      const { error: dbError } = await supabase.from("hazards").insert([
        {
          sender: from,
          message: text,
          raw_payload: body,
          created_at: new Date().toISOString(),
        },
      ]);

      if (dbError) {
        console.error("Supabase insert error:", dbError.message);
      }
    }

    // Always respond 200 OK to Meta
    return NextResponse.json({ status: "success" }, { status: 200 });
  } catch (error: any) {
    console.error("Unhandled Webhook POST Error:", error?.message || error);
    // Returning 200 prevents Meta from dropping the webhook subscription
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 200 });
  }
}
