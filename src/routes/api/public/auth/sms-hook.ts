import { createFileRoute } from "@tanstack/react-router";

// Phone OTP authentication has been retired. Contact phone numbers are kept
// only as profile data; authentication uses anonymous sessions for passengers
// and drivers, and invitation-based email access for administrators.
export const Route = createFileRoute("/api/public/auth/sms-hook")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          { error: { http_code: 410, message: "Phone OTP authentication is disabled." } },
          { status: 410 },
        ),
    },
  },
});
