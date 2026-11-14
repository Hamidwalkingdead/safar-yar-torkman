export type AppTarget = "passenger" | "driver" | "admin";
export type BuildTarget = AppTarget | "all";

const configuredTarget = import.meta.env.VITE_APP_TARGET;
export const APP_TARGET: BuildTarget =
  configuredTarget === "passenger" || configuredTarget === "driver" || configuredTarget === "admin"
    ? configuredTarget
    : "all";

const homePaths: Record<AppTarget, "/passenger" | "/driver" | "/admin"> = {
  passenger: "/passenger",
  driver: "/driver",
  admin: "/admin",
};

export function appHomePath(target: BuildTarget): "/" | "/passenger" | "/driver" | "/admin" {
  return target === "all" ? "/" : homePaths[target];
}

export function isAppRouteAllowed(pathname: string, target: BuildTarget): boolean {
  if (target === "all") return true;
  if (target === "admin") return pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/profile";

  const common = pathname === "/profile" || pathname === "/support" || pathname.startsWith("/trip/");
  if (common) return true;

  if (target === "passenger") {
    return pathname === "/" || pathname === "/passenger" || pathname === "/shared";
  }
  return pathname === "/" || pathname === "/driver";
}
