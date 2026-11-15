import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, vi } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedAuthProvider, SharedSignIn, useSharedAuth } from "@/components/shared-auth";

type Session = { user: { id: string; is_anonymous?: boolean } } | null;
type AuthListener = (event: string, session: Session) => void;
const authState = vi.hoisted(() => {
  const state: { listener?: AuthListener } = {};
  return {
    state,
    signInAnonymously: vi.fn(),
    onAuthStateChange: vi.fn((listener: AuthListener) => {
      state.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    signInAnonymously: authState.signInAnonymously,
    onAuthStateChange: authState.onAuthStateChange,
  } },
}));
function AuthStatus() {
  const { userId, ready, isAnonymous } = useSharedAuth();
  return <output>{ready ? (userId ? (isAnonymous ? "anonymous" : userId) : "signed-out") : "initializing"}</output>;
}
function mountProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><SharedAuthProvider><AuthStatus /></SharedAuthProvider></QueryClientProvider>);
  return queryClient;
}
afterEach(() => { cleanup(); authState.state.listener = undefined; vi.clearAllMocks(); });
describe("SharedAuthProvider", () => {
  it("uses the initial auth event as the startup session", () => {
    mountProvider();
    act(() => authState.state.listener?.("INITIAL_SESSION", { user: { id: "user-1" } }));
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(authState.signInAnonymously).not.toHaveBeenCalled();
  });
  it("starts an anonymous session when no session exists", () => {
    authState.signInAnonymously.mockResolvedValue({ error: null });
    mountProvider();
    act(() => authState.state.listener?.("INITIAL_SESSION", null));
    expect(screen.getByText("signed-out")).toBeInTheDocument();
    expect(authState.signInAnonymously).toHaveBeenCalledTimes(1);
  });
  it("clears cached user data on sign-out", () => {
    const client = mountProvider();
    client.setQueryData(["private-user-data"], { secret: "cached" });
    act(() => authState.state.listener?.("SIGNED_OUT", null));
    expect(client.getQueryData(["private-user-data"])).toBeUndefined();
  });
});
describe("phone-free access", () => {
  it("does not render a phone, SMS, or voice verification form in passenger/driver builds", () => {
    render(<SharedSignIn />);
    expect(screen.queryByLabelText("شماره همراه")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("کد تأیید")).not.toBeInTheDocument();
    expect(screen.queryByText("ارسال کد تأیید")).not.toBeInTheDocument();
  });
});
