import { describe, expect, it } from "vitest";
import { appHomePath, isAppRouteAllowed } from "./app-target";

describe("independent app route boundaries", () => {
  it("uses a dedicated landing route for each app", () => {
    expect(appHomePath("passenger")).toBe("/passenger");
    expect(appHomePath("driver")).toBe("/driver");
    expect(appHomePath("admin")).toBe("/admin");
  });

  it("keeps passenger and driver screens isolated", () => {
    expect(isAppRouteAllowed("/driver", "passenger")).toBe(false);
    expect(isAppRouteAllowed("/admin", "passenger")).toBe(false);
    expect(isAppRouteAllowed("/passenger", "driver")).toBe(false);
    expect(isAppRouteAllowed("/admin", "driver")).toBe(false);
  });

  it("allows shared account and trip workflows", () => {
    for (const target of ["passenger", "driver", "admin"] as const) {
      expect(isAppRouteAllowed("/profile", target)).toBe(true);
      expect(isAppRouteAllowed("/trip/abc", target)).toBe(true);
      expect(isAppRouteAllowed("/support", target)).toBe(true);
    }
  });

  it("does not expose passenger or driver panels in the admin app", () => {
    expect(isAppRouteAllowed("/passenger", "admin")).toBe(false);
    expect(isAppRouteAllowed("/driver", "admin")).toBe(false);
    expect(isAppRouteAllowed("/admin", "admin")).toBe(true);
  });

  it("preserves the existing all-in-one development mode", () => {
    expect(isAppRouteAllowed("/driver", "all")).toBe(true);
    expect(appHomePath("all")).toBe("/");
  });
});
