import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card } from "@/components/ui-kit";

type EmergencyType = "accident" | "threat";

export function TripEmergencyHelp({ tripId }: { tripId: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failedType, setFailedType] = useState<EmergencyType | null>(null);
  const [failureMessage, setFailureMessage] = useState("");

  async function send(type: EmergencyType) {
    if (busy || sent) return;
    setBusy(true);
    setFailureMessage("");
    try {
      const { error } = await supabase.rpc("create_trip_emergency_alert", {
        p_trip: tripId,
        p_type: type,
        p_lat: null,
        p_lng: null,
        p_accuracy: null,
      });
      if (error) throw error;
      setSent(true);
      setArmed(false);
      setFailedType(null);
      // Keep successful submission discreet: no sound, vibration, or explanatory toast.
    } catch (error) {
      setFailedType(type);
      setFailureMessage(error instanceof Error ? error.message : "ارسال درخواست اضطراری انجام نشد");
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2 border border-destructive/40">
      {!armed && !sent && !failedType ? (
        <Btn variant="ghost" onClick={() => setArmed(true)} className="w-full">
          کمک فوری
        </Btn>
      ) : sent ? (
        <p className="text-2xl text-center" role="status" aria-label="درخواست ارسال شد">👍😉</p>
      ) : failedType ? (
        <div className="space-y-2 text-center" role="alert">
          <p className="text-xl" aria-hidden="true">👎</p>
          <p className="text-sm">{failureMessage || "ارسال انجام نشد."}</p>
          <Btn disabled={busy} onClick={() => void send(failedType)} className="w-full">
            {busy ? "در حال ارسال…" : "تکرار کن"}
          </Btn>
          <Btn variant="ghost" disabled={busy} onClick={() => { setFailedType(null); setFailureMessage(""); }}>
            بازگشت
          </Btn>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-bold">نوع درخواست را انتخاب کنید</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={busy} onClick={() => void send("accident")}>
              {busy ? "در حال ارسال…" : "تصادف"}
            </Btn>
            <Btn disabled={busy} onClick={() => void send("threat")}>
              {busy ? "در حال ارسال…" : "تهدید"}
            </Btn>
          </div>
          <Btn variant="ghost" disabled={busy} onClick={() => setArmed(false)}>انصراف</Btn>
        </div>
      )}
    </Card>
  );
}
