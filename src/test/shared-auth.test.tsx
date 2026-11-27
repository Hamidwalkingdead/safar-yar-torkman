import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedAuthProvider, SharedSignIn, toIranE164, useSharedAuth } from "@/components/shared-auth";

type Session = { user: { id: string; is_anonymous?: boolean } } | null;
type AuthListener = (event: string, session: Session) => void;
const authState = vi.hoisted(() => {
  const state: { listener?: AuthListener } = {};
  return {
    state,
    getSession: vi.fn(),
    signInWithOtp: vi.fn(),
    updateUser: vi.fn(),
    verifyOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    onAuthStateChange: vi.fn((listener: AuthListener) => {
      state.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    getSession: authState.getSession,
    signInWithOtp: authState.signInWithOtp,
    updateUser: authState.updateUser,
    verifyOtp: authState.verifyOtp,
    signInWithPassword: authState.signInWithPassword,
    onAuthStateChange: authState.onAuthStateChange,
  } },
}));

function AuthStatus() {
  const { userId, ready, isAnonymous } = useSharedAuth();
  return <output>{ready ? (userId ? userId : (isAnonymous ? "anonymous-pending" : "signed-out")) : "initializing"}</output>;
}
function mountProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><SharedAuthProvider><AuthStatus /></SharedAuthProvider></QueryClientProvider>);
  return queryClient;
}
afterEach(() => {
  cleanup();
  authState.state.listener = undefined;
  vi.clearAllMocks();
});

describe("Iranian phone normalization", () => {
  it("normalizes local, international, Persian, and Arabic-Indic digits", () => {
    expect(toIranE164("09123456789")).toBe("+989123456789");
    expect(toIranE164("+98 912 345 6789")).toBe("+989123456789");
    expect(toIranE164("۰۹۱۲۳۴۵۶۷۸۹")).toBe("+989123456789");
    expect(toIranE164("٠٩١٢٣٤٥٦٧٨٩")).toBe("+989123456789");
    expect(toIranE164("02112345678")).toBeNull();
  });
});

describe("SharedAuthProvider", () => {
  it("uses the initial auth event as the startup session", () => {
    mountProvider();
    act(() => authState.state.listener?.("INITIAL_SESSION", { user: { id: "user-1" } }));
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });

  it("does not expose an anonymous session as an authenticated account", () => {
    mountProvider();
    act(() => authState.state.listener?.("INITIAL_SESSION", { user: { id: "temporary-1", is_anonymous: true } }));
    expect(screen.getByText("anonymous-pending")).toBeInTheDocument();
  });

  it("does not silently create anonymous sessions on app startup", () => {
    mountProvider();
    act(() => authState.state.listener?.("INITIAL_SESSION", null));
    expect(screen.getByText("signed-out")).toBeInTheDocument();
    expect(authState.getSession).not.toHaveBeenCalled();
  });

  it("clears cached user data on sign-out", () => {
    const client = mountProvider();
    client.setQueryData(["private-user-data"], { secret: "cached" });
    act(() => authState.state.listener?.("SIGNED_OUT", null));
    expect(client.getQueryData(["private-user-data"])).toBeUndefined();
  });
});

describe("phone OTP sign-in", () => {
  it("requests SMS OTP for a new device and verifies the six-digit code", async () => {
    authState.getSession.mockResolvedValue({ data: { session: null }, error: null });
    authState.signInWithOtp.mockResolvedValue({ error: null });
    authState.verifyOtp.mockResolvedValue({ data: { user: { id: "phone-user", is_anonymous: false }, session: {} }, error: null });

    render(<SharedSignIn />);
    fireEvent.change(screen.getByLabelText("شماره همراه"), { target: { value: "۰۹۱۲۳۴۵۶۷۸۹" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    await waitFor(() => expect(authState.signInWithOtp).toHaveBeenCalledWith({
      phone: "+989123456789",
      options: { shouldCreateUser: true },
    }));
    expect(await screen.findByLabelText("کد تأیید")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("کد تأیید"), { target: { value: "۱۲۳۴۵۶" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید کد و ورود" }));
    await waitFor(() => expect(authState.verifyOtp).toHaveBeenCalledWith({
      phone: "+989123456789",
      token: "123456",
      type: "sms",
    }));
  });

  it("upgrades an existing anonymous identity in place to preserve its user ID", async () => {
    authState.getSession.mockResolvedValue({
      data: { session: { user: { id: "existing-anon-user", is_anonymous: true } } },
      error: null,
    });
    authState.updateUser.mockResolvedValue({ error: null });
    authState.verifyOtp.mockResolvedValue({ data: { user: { id: "existing-anon-user", is_anonymous: false }, session: {} }, error: null });

    render(<SharedSignIn />);
    fireEvent.change(screen.getByLabelText("شماره همراه"), { target: { value: "09123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    await waitFor(() => expect(authState.updateUser).toHaveBeenCalledWith({ phone: "+989123456789" }));
    fireEvent.change(await screen.findByLabelText("کد تأیید"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید کد و ورود" }));
    await waitFor(() => expect(authState.verifyOtp).toHaveBeenCalledWith({
      phone: "+989123456789",
      token: "123456",
      type: "phone_change",
    }));
  });
});
