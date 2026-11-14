import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Car, Home, LifeBuoy, ShieldCheck, User, UserRound } from "lucide-react";
import { useAccount } from "@/lib/account";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { StoreProvider } from "@/lib/store";
import { Toaster } from "@/components/ui/sonner";
import { SharedAuthProvider, useSharedAuth } from "@/components/shared-auth";
import { TripLiveTracking } from "@/components/trip-live-tracking";
import { APP_TARGET, appHomePath, isAppRouteAllowed } from "@/lib/app-target";
import { supabase } from "@/integrations/supabase/client";
import { AppPermissionGate } from "@/components/app-permission-gate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      <div>
        <h1 className="text-6xl font-black">۴۰۴</h1>
        <p className="mt-3">صفحه پیدا نشد.</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-2xl bg-primary px-5 py-3 text-primary-foreground"
        >
          بازگشت به خانه
        </Link>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = errorMessage(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    console.error("[SafarYar startup error]", error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8 text-center">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-bold">خطایی رخ داد</h1>
        <p className="text-sm text-muted-foreground">
          جزئیات خطا برای عیب‌یابی:
        </p>
        <pre
          dir="ltr"
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-left text-xs"
        >
          {message}
        </pre>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="rounded-2xl bg-primary px-6 py-3 text-primary-foreground"
        >
          تلاش دوباره
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "سفر یار ترکمن" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap",
      },
      { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const homeNav = [
  { to: "/", label: "خانه", I: Home },
  { to: "/passenger", label: "مسافر", I: UserRound },
  { to: "/driver", label: "راننده", I: Car },
  { to: "/support", label: "پشتیبانی", I: LifeBuoy },
  { to: "/profile", label: "پروفایل", I: User },
] as const;

const passengerNav = [
  { to: "/passenger", label: "سفر من", I: UserRound },
  { to: "/support", label: "پشتیبانی", I: LifeBuoy },
  { to: "/profile", label: "پروفایل", I: User },
] as const;

const driverNav = [
  { to: "/driver", label: "سفرهای راننده", I: Car },
  { to: "/support", label: "پشتیبانی", I: LifeBuoy },
  { to: "/profile", label: "پروفایل", I: User },
] as const;

const adminNav = [{ to: "/admin", label: "مدیریت", I: ShieldCheck }] as const;

function ActiveTripLocationService() {
  const { userId, ready } = useSharedAuth();
  const activeTrip = useQuery({
    queryKey: ["global-active-trip-location", userId],
    enabled: ready && !!userId && APP_TARGET !== "admin",
    refetchInterval: 10000,
    queryFn: async () => {
      if (!userId) return null;
      const trackingWindowEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const baseQuery = supabase
        .from("trips")
        .select("id,passenger_id,driver_id,status")
        .in("status", ["pending", "accepted", "ongoing"]);
      const scopedQuery = APP_TARGET === "passenger"
        ? baseQuery.eq("passenger_id", userId)
        : APP_TARGET === "driver"
          ? baseQuery.eq("driver_id", userId)
          : baseQuery.or(`passenger_id.eq.${userId},driver_id.eq.${userId}`);
      const { data, error } = await scopedQuery
        // Do not collect GPS for scheduled rides until 15 minutes before departure.
        .lte("departure_at", trackingWindowEnd)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!userId || !activeTrip.data) return null;
  return (
    <TripLiveTracking
      tripId={activeTrip.data.id}
      userId={userId}
      passengerId={activeTrip.data.passenger_id}
      driverId={activeTrip.data.driver_id}
      status={activeTrip.data.status}
      origin={null}
      destination={null}
      route={null}
      renderUI={false}
    />
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <SharedAuthProvider>
        <StoreProvider>
          <div className="mx-auto min-h-screen max-w-xl pb-28">
            <div className="bg-ink py-1.5 text-center text-[11px] text-ink-foreground">
              نسخه آزمایشی · نقشه و مسیر جاده‌ای وابسته به کلید نشان · پرداخت آنلاین فعال نیست
            </div>
            <AppTargetGate><AppPermissionGate><ActiveTripLocationService /><Outlet /></AppPermissionGate></AppTargetGate>
          </div>
          <BottomNav />
          <Toaster position="top-center" />
        </StoreProvider>
      </SharedAuthProvider>
    </QueryClientProvider>
  );
}
function AppTargetGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const home = appHomePath(APP_TARGET);
  const allowed = isAppRouteAllowed(pathname, APP_TARGET);

  useEffect(() => {
    if (APP_TARGET !== "all" && (pathname === "/" || !allowed)) {
      void router.navigate({ to: home as never });
    }
  }, [pathname, router, home, allowed]);

  if (APP_TARGET !== "all" && (pathname === "/" || !allowed)) {
    return <div className="p-6 text-center text-sm text-muted-foreground">در حال باز کردن برنامه مربوط…</div>;
  }
  return <>{children}</>;
}

function BottomNav() {
  const account = useAccount();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isPassengerArea = pathname === "/passenger" || pathname.startsWith("/passenger/");
  const isDriverArea = pathname === "/driver" || pathname.startsWith("/driver/");
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const items = APP_TARGET === "passenger"
    ? passengerNav
    : APP_TARGET === "driver"
      ? driverNav
      : APP_TARGET === "admin"
        ? (account.data?.isAdmin ? adminNav : [])
        : isAdminArea
          ? (account.data?.isAdmin ? adminNav : [])
          : isPassengerArea
            ? passengerNav
            : isDriverArea
              ? driverNav
              : account.data?.isAdmin
                ? [...homeNav, { to: "/admin", label: "مدیریت", I: ShieldCheck } as const]
                : homeNav;
  if (!items.length) return null;
  return (
    <nav aria-label="ناوبری پنل" className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-md justify-around rounded-3xl bg-ink px-2 py-2 text-ink-foreground shadow-soft">
      {items.map(({ to, label, I }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          className="flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] opacity-70 [&.active]:bg-accent [&.active]:text-accent-foreground [&.active]:opacity-100"
        >
          <I className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
