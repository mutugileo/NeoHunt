import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Use POST to register." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Registration service is not configured." });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Send a valid registration payload." });
  }

  const email = cleanText(payload.email).toLowerCase();
  const password = cleanText(payload.password);
  const fullName = cleanText(payload.full_name);

  if (!email || !password || password.length < 6) {
    return jsonResponse(400, { error: "Enter a valid email and a password with at least 6 characters." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const userMetadata = {
    app_name: "neohunt",
    full_name: fullName,
  };

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (!error && data.user) {
    return jsonResponse(200, {
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  }

  const message = error?.message || "Could not create your account.";
  if (message.toLowerCase().includes("already")) {
    return jsonResponse(409, {
      code: "user_exists",
      error: "That email is already registered. Login instead, or send a password reset link.",
    });
  }

  return jsonResponse(400, { error: message });
});
