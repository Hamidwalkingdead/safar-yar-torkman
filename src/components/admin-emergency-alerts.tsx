import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Badge, Card } from "@/components/ui-kit";

type AlertRow = {
  id: string; trip_id: string; reporter_id: string; alert_type: "accident" | "threat";
  latitude: number | null; longitude: number | null; status: "open" | "acknowledged" | "resolved";
  created_at: string; admin_note: string | null;
};

export function AdminEmergencyAlerts() {
  const cache = useQueryClient();
  const alerts = useQuery({
    queryKey: ["admin-emergency-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trip_emergency_alerts")
        .select("id,trip_id,reporter_id,alert_type,latitude,longitude,status,created_at,admin_note")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const rows = (data ?? []) as AlertRow[];
      const tripIds = [...new Set(rows.map((r) => r.trip_id))];
      const userIds = [...new Set(rows.map((r) => r.reporter_id))];
      const [trips, profiles] = await Promise.all([
        tripIds.length ? supabase.from("trips").select("id,origin,destination,passenger_name,driver_id").in("id", tripIds) : Promise.resolve({ data: [], error: null }),
        userIds.length ? supabase.from("profiles").select("id,first_name,last_name,display_name,phone").in("id", userIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (trips.error) throw trips.error;
      if (profiles.error) throw profiles.error;
      return rows.map((row) => ({
        ...row,
        trip: trips.data?.find((t) => t.id === row.trip_id),
        profile: profiles.data?.find((p) => p.id === row.reporter_id),
      }));
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  async function update(id: string, status: "acknowledged" | "resolved") {
    try {
      const { error } = await supabase.rpc("admin_update_trip_emergency_alert", {
        p_alert: id, p_status: status, p_note: status === "resolved" ? "رسیدگی توسط مدیر ثبت شد" : null,
      });
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["admin-emergency-alerts"] });
      toast.success(status === "resolved" ? "درخواست به‌عنوان رسیدگی‌شده ثبت شد" : "دریافت هشدار تأیید شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "به‌روزرسانی هشدار انجام نشد");
    }
  }

  const openCount = alerts.data?.filter((a) => a.status === "open").length ?? 0;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-black">هشدارهای اضطراری</h2>
        <Badge tone={openCount ? "accent" : "primary"}>{openCount} رسیدگی‌نشده</Badge>
      </div>
      {alerts.isError && <p role="alert" className="text-sm text-destructive">دریافت هشدارهای اضطراری ناموفق بود.</p>}
      {alerts.isLoading && <p className="text-sm text-muted-foreground">در حال دریافت هشدارها…</p>}
      {!alerts.isLoading && !alerts.data?.length && <p className="rounded-xl bg-muted p-3 text-sm">درخواست اضطراری ثبت نشده است.</p>}
      {(alerts.data ?? []).map((a) => (
        <Card key={a.id} className={`space-y-2 border-2 ${a.status === "open" ? "border-destructive" : "border-border"}`}>
          <div className="flex items-center justify-between gap-2">
            <b>{a.alert_type === "accident" ? "تصادف" : "تهدید راننده / مسافر"}</b>
            <Badge tone={a.status === "open" ? "accent" : a.status === "resolved" ? "primary" : "secondary"}>
              {a.status === "open" ? "فوری · جدید" : a.status === "acknowledged" ? "دریافت شد" : "رسیدگی‌شده"}
            </Badge>
          </div>
          <p className="text-sm">{a.profile ? [a.profile.first_name, a.profile.last_name].filter(Boolean).join(" ") || a.profile.display_name || a.profile.phone : "کاربر سفر"} · {new Date(a.created_at).toLocaleString("fa-IR")}</p>
          <p className="text-sm">{a.trip?.origin ?? "مبدأ نامشخص"} ← {a.trip?.destination ?? "مقصد نامشخص"}</p>
          <p dir="ltr" className="break-all text-xs text-muted-foreground">سفر: {a.trip_id}</p>
          {a.latitude != null && a.longitude != null ? (
            <a className="block text-sm text-primary underline" href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noreferrer">بازکردن موقعیت اضطراری روی نقشه</a>
          ) : <p className="text-xs text-destructive">مختصات لحظه‌ای در هشدار موجود نیست؛ آخرین موقعیت سفر را بررسی کنید.</p>}
          {a.status === "open" && <Btn onClick={() => void update(a.id, "acknowledged")}>تأیید دریافت هشدار</Btn>}
          {a.status !== "resolved" && <Btn variant="ghost" onClick={() => void update(a.id, "resolved")}>ثبت رسیدگی‌شدن</Btn>}
          {a.status === "resolved" && a.admin_note && <p className="text-xs text-muted-foreground">{a.admin_note}</p>}
        </Card>
      ))}
    </section>
  );
}
