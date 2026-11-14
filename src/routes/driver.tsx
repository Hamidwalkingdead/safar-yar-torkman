import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Btn, Card, FareTable } from "@/components/ui-kit";
import { fa, toman } from "@/lib/fare";
import { useStore, statusLabel, type TripStatus } from "@/lib/store";
import { useSharedAuth, SharedSignIn } from "@/components/shared-auth";
import { useAccount } from "@/lib/account";
import { departureLabel } from "@/lib/shared-rides";
import { pendingForDriver } from "@/lib/trip-rules";
import { SharedRideChat } from "@/components/shared-ride-chat";
import { SharedRideLiveTracking } from "@/components/shared-ride-live-tracking";
import { DriverPresenceControl } from "@/components/driver-presence-control";
export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "پنل راننده | سفر یار ترکمن" },
      {
        name: "description",
        content: "درخواست‌های ورودی سفر، کرایه پیشنهادی مسافر و سهم خالص راننده.",
      },
      { property: "og:title", content: "پنل راننده | سفر یار ترکمن" },
      { property: "og:description", content: "درخواست‌های سفر را ببینید و بپذیرید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Driver,
});

function Driver() {
  const { trips, accept, refresh, loading, error } = useStore();
  const { userId } = useSharedAuth();
  const account = useAccount();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const verification = useQuery({
    queryKey: ["driver-verification", userId],
    enabled: !!userId && !!account.data?.isDriver,
    refetchInterval: 15000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const { data, error } = await (await import("@/integrations/supabase/client")).supabase
        .from("driver_verifications").select("status,note").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const verified = verification.data?.status === "approved";
  const cache = useQueryClient();
  const sharedRequests = useQuery({
    queryKey: ["driver-shared-rides", userId],
    enabled: !!userId && !!account.data?.isDriver && verified,
    queryFn: async () => {
      const { data, error } = await (await import("@/integrations/supabase/client")).supabase.rpc("driver_shared_requests");
      if (error) throw error;
      return (data ?? []) as { id: string; origin: string; destination: string; departureAt: string; totalFare: number; state: string; occupied: number; ownerName: string }[];
    },
    refetchInterval: 15000,
  });
  const assignedSharedRides = useQuery({
    queryKey: ["driver-assigned-shared-rides", userId],
    enabled: !!userId && !!account.data?.isDriver && verified,
    queryFn: async () => {
      const { data, error } = await (await import("@/integrations/supabase/client")).supabase.rpc("driver_assigned_shared_rides");
      if (error) throw error;
      return (data ?? []) as { id: string; origin: string; destination: string; departureAt: string; totalFare: number; state: string; occupied: number; ownerName: string }[];
    },
    refetchInterval: 15000,
  });
  async function takeShared(id: string) {
    setBusy(id);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.rpc("accept_shared_ride", { p_ride: id });
      if (error) throw error;
      toast.success("سفر اشتراکی به شما واگذار شد.");
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["driver-assigned-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["shared-rides"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پذیرش سفر اشتراکی انجام نشد");
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
    } finally { setBusy(null); }
  }
  async function changeSharedStatus(id: string, action: "start" | "complete" | "cancel") {
    setBusy(id);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const result = action === "start"
        ? await supabase.rpc("start_shared_ride", { p_ride: id })
        : action === "complete"
          ? await supabase.rpc("complete_shared_ride", { p_ride: id })
          : await supabase.rpc("cancel_shared_ride", { p_ride: id, p_reason: "لغو توسط راننده" });
      if (result.error) throw result.error;
      toast.success(action === "start" ? "سفر اشتراکی آغاز شد." : action === "complete" ? "پایان سفر ثبت شد." : "گروه سفر اشتراکی لغو شد.");
      await cache.invalidateQueries({ queryKey: ["driver-assigned-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["driver-shared-rides"] });
      await cache.invalidateQueries({ queryKey: ["shared-rides"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تغییر وضعیت سفر انجام نشد");
    } finally {
      setBusy(null);
    }
  }
  async function take(id: string) {
    setBusy(id);
    try {
      if (!verified) throw new Error("ابتدا باید مدارک و مشخصات شما توسط مدیر تأیید شود");
      await accept(id);
      await nav({ to: "/trip/$id", params: { id }, search: { as: "driver" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پذیرش انجام نشد");
    } finally {
      setBusy(null);
    }
  }
  const pending = trips.filter((t) => pendingForDriver(t, userId));
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-black">پنل راننده</h1>
      {!userId ? (
        <SharedSignIn />
      ) : account.isPending ? (
        <Card><p>در حال بررسی وضعیت حساب راننده…</p></Card>
      ) : account.isError ? (
        <Card><p role="alert">اطلاعات حساب دریافت نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.</p><Btn variant="ghost" onClick={() => void account.refetch()}>تلاش دوباره</Btn></Card>
      ) : !account.data?.isDriver ? (
        <Card>
          <p>برای پذیرش سفر، مشخصات خودرو را در پروفایل کامل و ثبت‌نام راننده را انجام دهید.</p>
          <Link to="/profile" className="text-primary">
            تکمیل پروفایل راننده
          </Link>
        </Card>
      ) : (
        <>
          <p>
            {account.data.profile.display_name} · {account.data.profile.car}
          </p>
          <Card className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <b>وضعیت تأیید رانندگی</b>
              {verification.isLoading ? <Badge>در حال بررسی</Badge> :
                verified ? <Badge tone="primary">تأیید شده</Badge> :
                verification.data?.status === "rejected" ? <Badge tone="accent">رد مدارک</Badge> :
                <Badge>در انتظار تأیید</Badge>}
            </div>
            {verification.isError ? (
              <p role="alert" className="text-sm text-destructive">وضعیت مدارک از سرور دریافت نشد؛ پذیرش سفر تا تأیید قطعی غیرفعال می‌ماند.</p>
            ) : verification.data?.note ? (
              <p className="text-sm">{verification.data.note}</p>
            ) : verified ? (
              <p className="text-sm">مدارک شما تأیید شده و امکان دریافت درخواست سفر فعال است.</p>
            ) : (
              <p className="text-sm">پس از بارگذاری و بررسی همه مدارک توسط مدیر، درخواست‌های سفر نمایش داده می‌شوند.</p>
            )}
            {!verified && <Link to="/profile" className="text-sm text-primary">بررسی یا تکمیل مدارک راننده</Link>}
          </Card>
          {verified && <DriverPresenceControl />}
          <Btn variant="ghost" onClick={refresh}>
            تازه‌سازی
          </Btn>
          {loading && <p>در حال دریافت…</p>}
          {error && <p role="alert">{error}</p>}
          {verified && <><h2 className="font-bold">درخواست‌های ورودی ({fa(pending.length)})</h2>
          {!pending.length && <p>درخواستی نیست.</p>}
          {pending.map((t) => (
            <Card key={t.id} className="space-y-3">
              <b>{t.passengerName}</b>
              <p>
                {t.from} ← {t.to} · {fa(t.km)} کیلومتر
              </p>
              <p className="text-sm">زمان حرکت: {departureLabel(t.departure_at)} · ثبت: {departureLabel(t.created_at)}</p>
              <div className="flex justify-between">
                <b>{toman(t.agreed_fare + (t.prior_debt_amount ?? 0))}</b>
                <span>سهم راننده: {toman(t.driver_net)}</span>
              </div>
              {(t.prior_debt_amount ?? 0) > 0 && (
                <div className="space-y-1 rounded-xl bg-muted p-3 text-sm">
                  <p className="font-bold">تسویه بدهی جریمه لغو قبلی</p>
                  <p>مبلغ بدهی مسافر: {toman(t.prior_debt_amount)}</p>
                  <p>سهم راننده از جریمه (۹۰٪): {toman(t.prior_debt_amount - Math.round(t.prior_debt_amount * 0.1))}</p>
                  <p>سهم سامانه (۱۰٪): {toman(Math.round(t.prior_debt_amount * 0.1))}</p>
                  <p className="text-xs text-muted-foreground">این بدهی جدا از کرایه سفر است؛ در نسخه فعلی کل مبلغ بدهی قبلی نقداً به راننده پرداخت می‌شود. تقسیم ۹۰/۱۰ فقط محاسباتی ثبت می‌شود و انتقال سهم سامانه فعلاً انجام نمی‌گیرد.</p>
                </div>
              )}
              <FareTable
                km={t.km}
                night={t.night}
                mountain={t.mountain}
                agreed={t.suggested ?? undefined}
              />
              <p className="text-xs text-muted-foreground">
                شماره مسافر فقط پس از پذیرش برای راننده همین سفر آشکار می‌شود.
              </p>
              <Btn disabled={!!busy} onClick={() => take(t.id)}>
                پذیرش سفر
              </Btn>
            </Card>
          ))}
          </>}
          {verified && <><h2 className="font-bold">درخواست‌های سفر اشتراکی ({fa(sharedRequests.data?.length ?? 0)})</h2>
          {sharedRequests.isLoading && <p>در حال دریافت سفرهای اشتراکی…</p>}
          {sharedRequests.isError && <p role="alert">دریافت سفرهای اشتراکی ناموفق بود.</p>}
          {!sharedRequests.isLoading && !sharedRequests.data?.length && <p className="text-sm text-muted-foreground">درخواست اشتراکی فعالی نیست.</p>}
          {sharedRequests.data?.map((r) => (
            <Card key={r.id} className="space-y-3 border-2 border-primary/20">
              <Badge tone="primary">درخواست سفر اشتراکی</Badge>
              <b>{r.ownerName}</b>
              <p>{r.origin} ← {r.destination}</p>
              <p className="text-sm">{departureLabel(r.departureAt)} · {fa(r.occupied)} از ۳ صندلی پر شده</p>
              <div className="flex justify-between gap-2">
                <b>کرایه کل: {toman(r.totalFare)}</b>
                <span className="text-sm">سهم هر نفر در ۳ نفر: {toman(Math.floor(r.totalFare / 3))}</span>
              </div>
              <Btn disabled={!!busy} onClick={() => takeShared(r.id)}>
                {busy === r.id ? "در حال پذیرش…" : "پذیرش سفر اشتراکی"}
              </Btn>
            </Card>
          ))}
          </>}
          {verified && <section className="space-y-3">
            <h2 className="font-bold">گروه‌های اشتراکی پذیرفته‌شده ({fa(assignedSharedRides.data?.length ?? 0)})</h2>
            {assignedSharedRides.isLoading && <p className="text-sm text-muted-foreground">در حال دریافت گروه‌های پذیرفته‌شده…</p>}
            {assignedSharedRides.isError && <p role="alert" className="text-sm text-destructive">دریافت گروه‌های پذیرفته‌شده ناموفق بود.</p>}
            {assignedSharedRides.data?.map((ride) => (
              <Card key={ride.id} className="space-y-3">
                <Badge>گروه سفر اشتراکی</Badge>
                <b>{ride.ownerName}</b>
                <p>{ride.origin} ← {ride.destination}</p>
                <p className="text-sm">{departureLabel(ride.departureAt)} · {fa(ride.occupied)} از ۳ نفر</p>
                <p className="font-bold">کرایه کل: {toman(ride.totalFare)}</p>
                <SharedRideChat rideId={ride.id} userId={userId!} enabled canSend={ride.state !== "cancelled" && ride.state !== "done"} />
                <SharedRideLiveTracking rideId={ride.id} userId={userId!} driverId={userId} enabled={ride.state !== "cancelled" && ride.state !== "done"} />
                {ride.state === "confirmed" && <Btn disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "start")}>{busy === ride.id ? "در حال ثبت…" : "آغاز سفر اشتراکی"}</Btn>}
                {ride.state === "ongoing" && <Btn disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "complete")}>{busy === ride.id ? "در حال ثبت…" : "پایان سفر اشتراکی"}</Btn>}
                {["open", "locked", "confirmed"].includes(ride.state) && <Btn variant="ghost" disabled={!!busy} onClick={() => void changeSharedStatus(ride.id, "cancel")}>لغو گروه سفر</Btn>}
                {ride.state === "ongoing" && <Badge tone="primary">در حال سفر</Badge>}
                {ride.state === "done" && <Badge>پایان یافته</Badge>}
              </Card>
            ))}
          </section>}
          <h2 className="font-bold">سفرهای من</h2>
          {trips
            .filter((t) => t.driver_id === userId)
            .map((t) => (
              <Link
                key={t.id}
                to="/trip/$id"
                params={{ id: t.id }}
                search={{ as: "driver" }}
                className="block"
              >
                <Card className="flex justify-between">
                  <span>
                    {t.passengerName} · {t.to}
                  </span>
                  <Badge>{statusLabel[t.status as TripStatus]}</Badge>
                </Card>
              </Link>
            ))}
        </>
      )}
    </div>
  );
}
