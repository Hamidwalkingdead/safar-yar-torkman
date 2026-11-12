import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
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
import { supabase } from "@/integrations/supabase/client";

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

const nav = [
  { to: "/", label: "خانه", I: Home },
  { to: "/passenger", label: "مسافر", I: UserRound },
  { to: "/driver", label: "راننده", I: Car },
  { to: "/support", label: "پشتیبانی", I: LifeBuoy },
  { to: "/profile", label: "پروفایل", I: User },
] as const;

function ActiveTripLocationService() {
  const { userId, ready } = useSharedAuth();
  const activeTrip = useQuery({
    queryKey: ["global-active-trip-location", userId],
    enabled: ready && !!userId,
    refetchInterval: 10000,
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("trips")
        .select("id,passenger_id,driver_id,status")
        .or(`passenger_id.eq.${userId},driver_id.eq.${userId}`)
        .in("status", ["accepted", "ongoing"])
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
          <ActiveTripLocationService />
          <div className="mx-auto min-h-screen max-w-xl pb-28">
            <div className="bg-ink py-1.5 text-center text-[11px] text-ink-foreground">
              ثبت و پذیرش سفر و مسیریابی جاده‌ای فعال · پرداخت آنلاین هنوز متصل نیست
            </div>
            <Outlet />
          </div>
          <BottomNav />
          <Toaster position="top-center" />
        </StoreProvider>
      </SharedAuthProvider>
    </QueryClientProvider>
  );
}
function BottomNav() {
  const account = useAccount();
  const roleItems = nav.filter(({ to }) => to !== "/driver" || account.data?.isDriver);
  const items = account.data?.isAdmin
    ? [...roleItems, { to: "/admin", label: "مدیریت", I: ShieldCheck } as const]
    : roleItems;
  return (
    <nav className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-md justify-around rounded-3xl bg-ink px-2 py-2 text-ink-foreground shadow-soft">
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
