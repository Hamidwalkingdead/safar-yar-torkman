import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card } from "@/components/ui-kit";

export function TripEmergencyHelp({ tripId }: { tripId: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send(type: "accident" | "threat") {
    if (busy || sent) return;
    setBusy(true);
    try {
      let point: { latitude: number; longitude: number; accuracy: number } | null = null;
      if (navigator.geolocation) {
        point = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }),
            () => resolve(null),
            { enableHighAccuracy: true, maximumAge: 15000, timeout: 2200 },
          );
        });
      }
      const { error } = await supabase.rpc("create_trip_emergency_alert", {
        p_trip: tripId,
        p_type: type,
        p_lat: point?.latitude ?? null,
        p_lng: point?.longitude ?? null,
        p_accuracy: point?.accuracy ?? null,
      });
      if (error) throw error;
      setSent(true);
      setArmed(false);
      // Keep the screen quiet: no sound, vibration, or prominent success toast.
    } catch (error) {
      setArmed(false);
      toast.error(error instanceof Error ? error.message : "ارسال درخواست اضطراری انجام نشد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2 border border-destructive/40">
      {!armed && !sent ? (
        <Btn variant="ghost" onClick={() => setArmed(true)} className="w-full">
          کمک فوری
        </Btn>
      ) : sent ? (
        <p className="text-xs text-muted-foreground" role="status">درخواست ثبت شد.</p>
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
