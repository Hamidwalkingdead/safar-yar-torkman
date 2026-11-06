import { createFileRoute } from "@tanstack/react-router";

// Sign-in "Send SMS" hook: the auth service calls this with the OTP, we deliver it via Kavenegar.
// Callers are verified with the Standard Webhooks signature (SEND_SMS_HOOK_SECRET).

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifySignature(secret: string, id: string, ts: string, body: string, header: string) {
  const raw = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...sig));
  return header.split(" ").some((part) => part.split(",")[1] === expected);
}

export function toKavenegarReceptor(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  const m = d.match(/^(?:98|0)?(9\d{9})$/);
  return m ? `0${m[1]}` : null;
}

export const Route = createFileRoute("/api/public/auth/sms-hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["SEND_SMS_HOOK_SECRET"];
        const apiKey = process.env["KAVENEGAR_API_KEY"];
        const template = process.env["KAVENEGAR_OTP_TEMPLATE"];
        if (!secret || !apiKey || !template) return Response.json({ error: { http_code: 500, message: "SMS not configured" } }, { status: 500 });
        const body = await request.text();
        const id = request.headers.get("webhook-id") ?? "";
        const ts = request.headers.get("webhook-timestamp") ?? "";
        const sig = request.headers.get("webhook-signature") ?? "";
        const age = Math.abs(Date.now() / 1000 - Number(ts));
        if (!id || !Number.isFinite(age) || age > 300 || !(await verifySignature(secret, id, ts, body, sig)))
          return Response.json({ error: { http_code: 401, message: "Invalid signature" } }, { status: 401 });
        let payload: { user?: { phone?: string }; sms?: { otp?: string } };
        try { payload = JSON.parse(body); } catch { return Response.json({ error: { http_code: 400, message: "Bad JSON" } }, { status: 400 }); }
        const receptor = toKavenegarReceptor(payload.user?.phone ?? "");
        const otp = payload.sms?.otp ?? "";
        if (!receptor || !/^\d{4,10}$/.test(otp)) return Response.json({ error: { http_code: 400, message: "Invalid phone or code" } }, { status: 400 });
        const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json?` + new URLSearchParams({ receptor, token: otp, template });
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const text = await res.text();
          console.error(`Kavenegar failed [${res.status}]: ${text.slice(0, 300)}`);
          return Response.json({ error: { http_code: 502, message: `SMS provider error ${res.status}` } }, { status: 502 });
        }
        return Response.json({});
      },
    },
  },
});
