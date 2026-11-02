import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./store";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  removeChannel: vi.fn(),
  event: undefined as (() => void) | undefined,
  connection: undefined as (() => void) | undefined,
}));
vi.mock("@/components/shared-auth", () => ({ useSharedAuth: () => ({ userId: "driver-a" }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => ({
          data: table === "trips" ? mocks.rows.map((row) => ({ ...row })) : [],
          error: null,
        }),
      }),
    }),
    rpc: mocks.rpc,
    channel: () => {
      const channel = {
        on: (_event: string, _filter: unknown, callback: () => void) => {
          mocks.event = callback;
          return channel;
        },
        subscribe: (callback: () => void) => {
          mocks.connection = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: mocks.removeChannel,
  },
}));

function Probe() {
  const { trips, accept } = useStore();
  return (
    <div>
      <output aria-label="status">{trips[0]?.status ?? "empty"}</output>
      <button onClick={() => void accept("trip-a").catch(() => {})}>accept</button>
    </div>
  );
}
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <StoreProvider>
        <Probe />
      </StoreProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
};
describe("trip synchronization fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [
      {
        id: "trip-a",
        status: "pending",
        origin: "گرگان",
        destination: "تهران",
        passenger_name: "آزمایشی",
      },
    ];
    mocks.rpc.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it("Realtime updates the visible trip and teardown removes its channel", async () => {
    const { unmount, client } = mount();
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("pending"));
    mocks.rows[0] = { ...mocks.rows[0], status: "accepted" };
    act(() => mocks.event?.());
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("accepted"));
    unmount();
    client.clear();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("polling removes a lost offer without receiving any Realtime event", async () => {
    const { client } = mount();
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("pending"));
    mocks.rows = [];
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("empty"), { timeout: 6500 });
    client.clear();
  }, 7500);
  it("a conflicting acceptance refreshes stale offers even though the RPC failed", async () => {
    const { client } = mount();
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("pending"));
    mocks.rows = [];
    mocks.rpc.mockResolvedValue({ error: { message: "already accepted", code: "PT409" } });
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(screen.getByLabelText("status")).toHaveTextContent("empty"));
    expect(mocks.rpc).toHaveBeenCalledWith("change_trip_status", {
      p_trip: "trip-a",
      p_status: "accepted",
    });
    client.clear();
  });
});
