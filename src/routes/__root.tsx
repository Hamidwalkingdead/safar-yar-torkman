import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Car, Home, LifeBuoy, User, UserRound } from "lucide-react";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { StoreProvider } from "@/lib/store";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      <div><h1 className="text-6xl font-black">۴۰۴</h1><p className="mt-3">صفحه پیدا نشد.</p>
        <Link to="/" className="mt-6 inline-block rounded-2xl bg-primary px-5 py-3 text-primary-foreground">بازگشت به خانه</Link></div>
    </div>
  );
}
function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      <div><h1 className="text-xl font-bold">خطایی رخ داد</h1>
        <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 rounded-2xl bg-primary px-5 py-3 text-primary-foreground">تلاش دوباره</button></div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "راه‌یار" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap" },
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
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <div className="mx-auto min-h-screen max-w-xl pb-28">
          <div className="bg-ink py-1.5 text-center text-[11px] text-ink-foreground">نسخه نمایشی (دمو) — تماس، پرداخت، GPS و اعزام زنده واقعی نیستند</div>
          <Outlet />
        </div>
        <nav className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-md justify-around rounded-3xl bg-ink px-2 py-2 text-ink-foreground shadow-soft">
          {nav.map(({ to, label, I }) => (
            <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className="flex flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 text-[11px] opacity-70 [&.active]:bg-accent [&.active]:text-accent-foreground [&.active]:opacity-100">
              <I className="size-5" />{label}
            </Link>
          ))}
        </nav>
      </StoreProvider>
    </QueryClientProvider>
  );
}
