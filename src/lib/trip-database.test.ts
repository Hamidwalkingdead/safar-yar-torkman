// @vitest-environment node
// Isolated PostgreSQL only: never point this test at the application database.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env['TRIP_TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;
const passenger = "10000000-0000-0000-0000-000000000001";
const driverA = "10000000-0000-0000-0000-000000000002";
const driverB = "10000000-0000-0000-0000-000000000003";
const outsider = "10000000-0000-0000-0000-000000000004";

suite("isolated PostgreSQL trip RPC/RLS", () => {
  const sql = postgres(url ?? "postgres://localhost:55432/trip_test", { max: 6 });
  const migration = (name: string) => readFileSync(`drizzle/migrations/${name}`, "utf8");
  async function asUser<T>(id: string, work: (tx: postgres.TransactionSql) => Promise<T>) {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub', ${id}, true)`;
      return work(tx);
    });
    return result as T;
  }
  async function create(id = passenger) {
    return asUser(id, async (tx) => {
      const [row] =
        await tx`SELECT public.create_trip('گرگان','تهران',now()+interval '1 day',350,false,true,NULL) AS id`;
      return row?.['id'] as string;
    });
  }
  const change = (id: string, ride: string, status: string) =>
    asUser(id, async (tx) => {
      await tx`SELECT public.change_trip_status(${ride}::uuid,${status})`;
    });
  const contacts = (id: string, ride: string) =>
    asUser(id, async (tx) => {
      const [row] = await tx`SELECT public.trip_contacts(${ride}::uuid) AS data`;
      return row?.['data'];
    });

  beforeAll(async () => {
    const [database] = await sql`SELECT current_database() AS name`;
    if (database?.['name'] !== "trip_test" || !url?.includes("localhost:55432")) {
      throw new Error("Trip tests require the isolated localhost:55432/trip_test database");
    }
    await sql.unsafe(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
      CREATE PUBLICATION supabase_realtime;`);
    await sql.unsafe(migration("0001_persistent_intercity_trips.sql"));
    // Apply the currently deployed automatic-night create_trip definition.
    const automatic = migration("0003_driver_documents_auto_night.sql");
    await sql.unsafe(
      automatic.slice(automatic.indexOf("CREATE OR REPLACE FUNCTION public.create_trip")),
    );
    await sql.unsafe(migration("0006_trip_acceptance_conflicts.sql"));
  }, 20000);
  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE public.trip_events,public.trips,public.user_roles,public.profiles,auth.users CASCADE",
    );
    for (const id of [passenger, driverA, driverB, outsider]) {
      await sql`INSERT INTO auth.users(id) VALUES(${id})`;
      await sql`UPDATE public.profiles SET display_name='مسافر آزمایشی',phone='09000000000',car='خودرو آزمایشی',plate='آزمایشی' WHERE id=${id}`;
    }
    for (const id of [driverA, driverB])
      await sql`INSERT INTO public.user_roles(user_id,role) VALUES(${id},'driver')`;
  });
  afterAll(async () => {
    await sql.end();
  });

  it("persists request, name and unchanged 10% commission; both drivers read it", async () => {
    const ride = await create();
    for (const driver of [driverA, driverB]) {
      const rows = await asUser(driver, (tx) => tx`SELECT * FROM public.trips WHERE id=${ride}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['passenger_name']).toBe("مسافر آزمایشی");
      expect(rows[0]?.['commission']).toBe(Math.round(rows[0]?.['agreed_fare'] * 0.1));
      expect(rows[0]?.['driver_net'] + rows[0]?.['commission']).toBe(rows[0]?.['agreed_fare']);
    }
    expect(await asUser(outsider, (tx) => tx`SELECT id FROM public.trips`)).toHaveLength(0);
  });
  it("rejects self acceptance and unregistered drivers", async () => {
    const own = await create(driverA);
    await expect(change(driverA, own, "accepted")).rejects.toThrow("خودتان");
    const ride = await create();
    await expect(change(outsider, ride, "accepted")).rejects.toThrow("ثبت‌نام");
  });
  it("concurrent drivers produce exactly one assignment and one clear conflict", async () => {
    const ride = await create();
    const results = await Promise.allSettled([
      change(driverA, ride, "accepted"),
      change(driverB, ride, "accepted"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.['status'] === "rejected" && rejected.reason.code).toBe("PT409");
    const [row] = await sql`SELECT driver_id,status FROM public.trips WHERE id=${ride}`;
    expect(row?.['status']).toBe("accepted");
    const losing = row?.['driver_id'] === driverA ? driverB : driverA;
    expect(
      await asUser(losing, (tx) => tx`SELECT * FROM public.trips WHERE id=${ride}`),
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM public.trip_events WHERE trip_id=${ride} AND status='accepted'`,
    ).toHaveLength(1);
  });
  it("contacts are hidden pending, revealed to participants only, and hidden cancelled", async () => {
    const ride = await create();
    expect(await contacts(passenger, ride)).toEqual({});
    expect(await contacts(driverA, ride)).toEqual({});
    await change(driverA, ride, "accepted");
    expect((await contacts(passenger, ride)).driver.phone).toBe("09000000000");
    expect((await contacts(driverA, ride)).passenger.phone).toBe("09000000000");
    expect(await contacts(driverB, ride)).toEqual({});
    expect(
      await asUser(driverB, (tx) => tx`SELECT phone FROM public.profiles WHERE id=${passenger}`),
    ).toHaveLength(0);
    expect(
      await asUser(driverB, (tx) => tx`SELECT * FROM public.trip_events WHERE trip_id=${ride}`),
    ).toHaveLength(0);
    await change(passenger, ride, "cancelled");
    expect(await contacts(passenger, ride)).toEqual({});
  });
  it("only assigned driver starts/finishes; passenger cannot start or finish", async () => {
    const ride = await create();
    await change(driverA, ride, "accepted");
    await expect(change(passenger, ride, "ongoing")).rejects.toThrow("مجاز نیست");
    await expect(change(driverB, ride, "ongoing")).rejects.toThrow("مجاز نیست");
    await expect(change(driverA, ride, "done")).rejects.toThrow("مجاز نیست");
    await change(driverA, ride, "ongoing");
    await expect(change(passenger, ride, "done")).rejects.toThrow("مجاز نیست");
    await change(driverA, ride, "done");
    expect(
      (await asUser(passenger, (tx) => tx`SELECT status FROM public.trips WHERE id=${ride}`))[0]
        ?.['status'],
    ).toBe("done");
    await expect(change(driverA, ride, "cancelled")).rejects.toThrow("مجاز نیست");
  });
  it("direct trip writes and cross-passenger reads cannot bypass RPC", async () => {
    const ride = await create();
    await expect(
      asUser(passenger, (tx) => tx`UPDATE public.trips SET status='done' WHERE id=${ride}`),
    ).rejects.toThrow();
    expect(
      await asUser(outsider, (tx) => tx`SELECT * FROM public.trips WHERE id=${ride}`),
    ).toHaveLength(0);
    await expect(change(outsider, ride, "cancelled")).rejects.toThrow("مجاز نیست");
  });
});
