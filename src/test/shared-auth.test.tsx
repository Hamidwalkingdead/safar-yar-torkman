import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedAuthProvider, SharedSignIn, useSharedAuth } from "@/components/shared-auth";

type Session = { user: { id: string } } | null;
type AuthListener = (event: string, session: Session) => void;

const authState = vi.hoisted(() => {
  const state: { listener?: AuthListener } = {};
  return {
    state,
    getUser: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    onAuthStateChange: vi.fn((listener: AuthListener) => {
      state.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: authState.getUser,
      signInWithOtp: authState.signInWithOtp,
      verifyOtp: authState.verifyOtp,
      onAuthStateChange: authState.onAuthStateChange,
    },
  },
}));

function AuthStatus() {
  const { userId, ready } = useSharedAuth();
  return <output>{ready ? (userId ?? "signed-out") : "initializing"}</output>;
}

function mountProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SharedAuthProvider>
        <AuthStatus />
      </SharedAuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  authState.state.listener = undefined;
  vi.clearAllMocks();
});

describe("SharedAuthProvider session initialization", () => {
  it("uses the initial auth event as the startup session", () => {
    mountProvider();

    expect(screen.getByText("initializing")).toBeInTheDocument();
    act(() => authState.state.listener?.("INITIAL_SESSION", { user: { id: "user-1" } }));

    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(authState.getUser).not.toHaveBeenCalled();
  });

  it("becomes ready when the initial auth event has no session", () => {
    mountProvider();

    act(() => authState.state.listener?.("INITIAL_SESSION", null));

    expect(screen.getByText("signed-out")).toBeInTheDocument();
    expect(authState.getUser).not.toHaveBeenCalled();
  });

  it("clears cached user data on sign-out", () => {
    const queryClient = mountProvider();
    queryClient.setQueryData(["private-user-data"], { secret: "cached" });
    act(() => authState.state.listener?.("SIGNED_OUT", null));

    expect(screen.getByText("signed-out")).toBeInTheDocument();
    expect(queryClient.getQueryData(["private-user-data"])).toBeUndefined();
  });
});

describe("phone-only sign-in", () => {
  it("requires an Iranian mobile number and requests an SMS code by default", async () => {
    authState.signInWithOtp.mockResolvedValue({ error: null });
    render(<SharedSignIn />);

    const phone = screen.getByLabelText("شماره همراه");
    expect(phone).toBeInTheDocument();
    expect(screen.queryByText(/بدون کد پیامکی/)).not.toBeInTheDocument();
    fireEvent.change(phone, { target: { value: "۰۹۱۲۳۴۵۶۷۸۹" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    await waitFor(() => {
      expect(authState.signInWithOtp).toHaveBeenCalledWith({ phone: "+989123456789" });
    });
    expect(screen.getByText(/کد پیامک‌شده به/)).toBeInTheDocument();
  });

  it("does not send an OTP for an invalid mobile number", async () => {
    render(<SharedSignIn />);

    fireEvent.change(screen.getByLabelText("شماره همراه"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("شماره همراه معتبر ایران");
    expect(authState.signInWithOtp).not.toHaveBeenCalled();
  });
});
