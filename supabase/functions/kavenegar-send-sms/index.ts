import { Webhook } from "npm:standardwebhooks@1.0.0";

type AuthSmsEvent = {
  user?: { phone?: string };
  sms?: { otp?: string };
};

function normalizeIranPhone(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (/^09[0-9]{9}$/.test(digits)) return digits;
  if (/^9[0-9]{9}$/.test(digits)) return `0${digits}`;
  if (/^989[0-9]{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^00989[0-9]{9}$/.test(digits)) return `0${digits.slice(4)}`;
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
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
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const apiKey = Deno.env.get("KAVENEGAR_API_KEY");
  const sender = Deno.env.get("KAVENEGAR_SENDER");
  const template = Deno.env.get("KAVENEGAR_VERIFY_TEMPLATE");

  if (!hookSecret || !apiKey || (!sender && !template))
    return json({ error: "Kavenegar SMS hook is not configured" }, 503);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 16_384) return json({ error: "Payload too large" }, 413);
    const event = await verifyHook(request, rawBody, hookSecret);
    if (!event) return json({ error: "Invalid Auth Hook signature" }, 401);

    const phone = normalizeIranPhone(event.user?.phone ?? "");
    const otp = event.sms?.otp ?? "";
    if (!phone || !/^\d{6}$/.test(otp))
      return json({ error: "Invalid phone number or OTP payload" }, 400);

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
    const timeout = setTimeout(() => controller.abort(), 10_000);
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
      return json({ error: "SMS provider rejected the message" }, 502);
    }
    return json({});
  } catch (error) {
    console.error("Kavenegar Auth SMS failed", error);
    return json({ error: "Unable to send authentication SMS" }, 502);
  }
});
