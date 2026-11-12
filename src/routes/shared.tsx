import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type SharedRide, departureLabel } from "@/lib/shared-rides";
import { fa, toman } from "@/lib/fare";
import { Badge, Btn, Card } from "@/components/ui-kit";
import { SharedSignIn, useSharedAuth } from "@/components/shared-auth";
import { toast } from "sonner";
import { RefreshCw, Users } from "lucide-react";

export const Route = createFileRoute("/shared")({
  head: () => ({
    meta: [
      { title: "درخواست‌های اشتراکی من | سفر یار ترکمن" },
      { name: "description", content: "درخواست‌های هم‌مسیر خود را ببینید و سهم کرایه را تأیید کنید." },
    ],
  }),
  component: Shared,
});

type SharedDriver = { name: string; car: string; plate: string; acceptedAt: string } | null;

function Shared() {
  const { userId, ready } = useSharedAuth();
  const cache = useQueryClient();
  const ridesQuery = useQuery({
    queryKey: ["shared-rides", "mine", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shared_listing");
      if (error) throw error;
      return (data ?? []) as unknown as SharedRide[];
    },
    refetchInterval: 15000,
  });
  const rides = ridesQuery.data ?? [];
  const driverStatuses = useQueries({
    queries: rides.map((ride) => ({
      queryKey: ["shared-driver-status", ride.id],
      enabled: !!userId,
      queryFn: async () => {
        const { data, error } = await supabase.rpc("shared_driver_status", { p_ride: ride.id });
        if (error) throw error;
        return data as SharedDriver;
      },
      refetchInterval: 15000,
    })),
  });
  const driverByRide = new Map(
    rides.map((ride, index) => [ride.id, driverStatuses[index]?.data ?? null]),
  );
  const refresh = () => cache.invalidateQueries({ queryKey: ["shared-rides"] });

  async function apply(ride: SharedRide, kind: "lock" | "confirm") {
    try {
      const result = kind === "lock"
        ? await supabase.rpc("lock_shared_ride", { p_ride: ride.id })
        : await supabase.rpc("confirm_shared_price", {
            p_ride: ride.id,
            p_amount: ride.myBooking?.amount ?? 0,
            p_consent: true,
          });
      if (result.error) {
        toast.error("ثبت انجام نشد؛ اطلاعات تازه را بررسی کنید.");
        await refresh();
        return;
      }
      toast.success(kind === "lock" ? "ظرفیت این گروه بسته شد." : "سهم کرایه نهایی شما تأیید شد.");
      await refresh();
    } catch {
      toast.error("ارتباط برقرار نشد؛ دوباره تلاش کنید.");
    }
  }

  if (!ready) return <div className="p-6 text-sm text-muted-foreground">در حال بررسی حساب…</div>;
  if (!userId) return <div className="space-y-4 p-4"><h1 className="text-2xl font-black">درخواست‌های اشتراکی من</h1><SharedSignIn /></div>;

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-black">درخواست‌های اشتراکی من</h1>
          <p className="mt-1 text-sm text-muted-foreground">هم‌مسیرها به‌صورت خودکار پیدا می‌شوند · حداکثر ۳ مسافر</p>
        </div>
        <Users className="size-9 shrink-0 text-primary" />
      </header>
      <p className="text-sm text-muted-foreground">
        هنگام ثبت درخواست، سامانه مبدأ و مقصد یکسان و زمان حرکت با حداکثر ۶۰ دقیقه اختلاف را بررسی می‌کند.
        فهرست عمومی سفرهای دیگران نمایش داده نمی‌شود. پذیرش راننده در پنل راننده فعال است؛ چت، GPS زنده و تسویه مالی سفر اشتراکی هنوز به چرخه اصلی سفر متصل نشده‌اند.
      </p>
      <div className="flex items-center justify-between gap-2">
        <Link to="/passenger" className="text-sm font-bold text-primary">+ ثبت درخواست اشتراکی</Link>
        <Btn variant="ghost" aria-label="تازه‌سازی درخواست‌ها" title="تازه‌سازی" onClick={refresh} className="px-3">
          <RefreshCw className="size-4" />
        </Btn>
      </div>

      {ridesQuery.isLoading && <p className="text-sm text-muted-foreground">در حال دریافت درخواست‌ها…</p>}
      {ridesQuery.isError && (
        <Card className="space-y-2">
          <p className="text-sm">دریافت درخواست‌های شما ممکن نشد.</p>
          <Btn variant="ghost" onClick={() => void ridesQuery.refetch()}>تلاش دوباره</Btn>
        </Card>
      )}
      {!ridesQuery.isLoading && !ridesQuery.isError && rides.length === 0 && (
        <Card className="space-y-3 text-center">
          <p className="font-bold">هنوز درخواست اشتراکی ثبت نکرده‌اید.</p>
          <p className="text-sm text-muted-foreground">مبدأ و مقصد بین‌شهری را انتخاب کنید تا سامانه درخواست‌های هم‌مسیر را پیدا کند.</p>
          <Link to="/passenger" className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-5 py-3 font-bold text-primary-foreground">ثبت درخواست سفر</Link>
        </Card>
      )}

      <div className="space-y-3">
        {rides.map((ride) => {
          const driver = driverByRide.get(ride.id);
          const booking = ride.myBooking;
          const status = ride.state === "confirmed"
            ? "سهم کرایه نهایی شد"
            : ride.state === "locked"
              ? "ظرفیت بسته شده"
              : "در انتظار هم‌مسیر";
          return (
            <Card key={ride.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Badge>{status}</Badge>
                <span className="text-xs text-muted-foreground">{departureLabel(ride.departureAt)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">مبدأ</span><b className="mt-1 block">{ride.origin}</b></div>
                <div><span className="text-muted-foreground">مقصد</span><b className="mt-1 block">{ride.destination}</b></div>
              </div>
              <div className="rounded-xl bg-muted p-3 text-sm">
                <div className="flex justify-between"><span>ظرفیت گروه</span><b>{fa(ride.occupied)} از ۳ نفر</b></div>
                <div className="mt-1 flex justify-between"><span>کرایه کل سرویس</span><b>{toman(ride.totalFare)}</b></div>
                {booking && <div className="mt-1 flex justify-between"><span>سهم شما · {fa(booking.seats)} نفر</span><b>{toman(booking.amount)}</b></div>}
              </div>
              {ride.occupied > (booking?.seats ?? 0) && (
                <p className="text-xs text-primary">درخواست شما با درخواست هم‌مسیر دیگری گروه‌بندی شده است.</p>
              )}
              {driver ? (
                <div className="rounded-xl border border-primary/20 p-3 text-sm">
                  <b>راننده پذیرفته است</b>
                  <p className="mt-1">{driver.name} · {driver.car} · پلاک {driver.plate}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">هنوز راننده‌ای این گروه را نپذیرفته است.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {ride.isOwner && ride.state === "open" && (
                  <Btn variant="ghost" className="flex-1" onClick={() => void apply(ride, "lock")}>بستن ظرفیت گروه</Btn>
                )}
                {ride.state === "locked" && booking && !booking.confirmed && (
                  <Btn className="flex-1" onClick={() => void apply(ride, "confirm")}>تأیید سهم نهایی</Btn>
                )}
              </div>
              {ride.state === "confirmed" && <p className="text-xs text-primary">همه مسافران سهم نهایی خود را تأیید کرده‌اند.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
