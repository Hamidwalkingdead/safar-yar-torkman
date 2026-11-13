import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { normalizeIranPhone } from "../_shared/iran-phone.ts";

type AuthSmsEvent = {
  user?: { phone?: string };
  sms?: { otp?: string };
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function failure(message: string, status: number): Response {
  return json({ error: { http_code: status, message } }, status);
}

async function verifyHook(request: Request, payload: string, secretValue: string): Promise<AuthSmsEvent | null> {
  const headers = Object.fromEntries(request.headers);
  for (const candidate of secretValue.split("|")) {
    const secret = candidate.trim().replace(/^v1,whsec_/, "");
    if (!secret) continue;
    try {
      return new Webhook(secret).verify(payload, headers) as AuthSmsEvent;
    } catch {
      // Try the next active signing secret during key rotation.
    }
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return failure("Method not allowed", 405);

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const apiKey = Deno.env.get("KAVENEGAR_API_KEY");
  const sender = Deno.env.get("KAVENEGAR_SENDER");
  const template = Deno.env.get("KAVENEGAR_VERIFY_TEMPLATE");

  if (!hookSecret || !apiKey || (!sender && !template))
    return failure("Kavenegar SMS hook is not configured", 503);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 16_384) return failure("Payload too large", 413);
    const event = await verifyHook(request, rawBody, hookSecret);
    if (!event) return failure("Invalid Auth Hook signature", 401);

    const phone = normalizeIranPhone(event.user?.phone ?? "");
    const otp = event.sms?.otp ?? "";
    if (!phone || !/^\d{6}$/.test(otp))
      return failure("Invalid phone number or OTP payload", 400);

    const endpoint = template ? "verify/lookup.json" : "sms/send.json";
    const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/${endpoint}`;
    const form = new URLSearchParams({ receptor: phone });
    if (template) {
      form.set("token", otp);
      form.set("template", template);
    } else {
      form.set("sender", sender!);
      form.set("message", `کد ورود سفر‌یار ترکمن: ${otp}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_500);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const result = await response.json() as {
      return?: { status?: number; message?: string; messageid?: number };
    };
    if (!response.ok || result.return?.status !== 200) {
      console.error("Kavenegar rejected Auth SMS", result.return?.status);
      return failure("SMS provider rejected the message", 502);
    }
    return json({});
  } catch (error) {
    console.error("Kavenegar Auth SMS failed", error);
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(JSON.stringify({ error: { http_code: 503, message: "SMS provider timed out" } }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": "true" },
      });
    }
    return failure("Unable to send authentication SMS", 502);
  }
});
