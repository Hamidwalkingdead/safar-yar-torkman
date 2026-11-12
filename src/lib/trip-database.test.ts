// @vitest-environment node
// Isolated PostgreSQL only: never point this test at the application database.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env["TRIP_TEST_DATABASE_URL"];
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
  async function create(id = passenger, paymentMethod: "cash" | "wallet" = "cash") {
    return asUser(id, async (tx) => {
      const [row] = await tx`
        SELECT public.create_trip(
          p_origin := 'گرگان',
          p_destination := 'تهران',
          p_departure := now()+interval '1 day',
          p_km := 10,
          p_night := false,
          p_mountain := false,
          p_origin_lat := 36.84,
          p_origin_lng := 54.43,
          p_destination_lat := 35.68,
          p_destination_lng := 51.38,
          p_payment_method := ${paymentMethod},
          p_ride_type := 'intercity'
        ) AS id
      `;
      return row?.["id"] as string;
    });
  }
  const change = (id: string, ride: string, status: string) =>
    asUser(id, async (tx) => {
      await tx`SELECT public.change_trip_status(${ride}::uuid,${status})`;
    });
  const contacts = (id: string, ride: string) =>
    asUser(id, async (tx) => {
      const [row] = await tx`SELECT public.trip_contacts(${ride}::uuid) AS data`;
      return row?.["data"];
    });

  beforeAll(async () => {
    const [database] = await sql`SELECT current_database() AS name`;
    if (database?.["name"] !== "trip_test" || !url?.includes("localhost:55432")) {
      throw new Error("Trip tests require the isolated localhost:55432/trip_test database");
    }
    await sql.unsafe(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
      CREATE PUBLICATION supabase_realtime;
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,PRIMARY KEY(bucket_id,name));
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
      CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE
        AS $$ SELECT string_to_array($1,'/') $$;`);
    await sql.unsafe(migration("0000_shared_rides.sql"));
    await sql.unsafe(migration("0001_persistent_intercity_trips.sql"));
    await sql.unsafe(migration("0002_profile_phone_from_auth.sql"));
    await sql.unsafe(migration("0003_driver_documents_auto_night.sql"));
    await sql.unsafe(migration("0004_admin_role_enum.sql"));
    await sql.unsafe(migration("0005_admin_access.sql"));
    await sql.unsafe(migration("0006_trip_acceptance_conflicts.sql"));
    await sql.unsafe(migration("0007_trip_chat_voice.sql"));
    await sql.unsafe(migration("0008_immediate_trip_requests.sql"));
    await sql.unsafe(migration("0009_shared_ride_driver_acceptance.sql"));
    await sql.unsafe(migration("0010_driver_identity_verification.sql"));
    await sql.unsafe(migration("0011_account_wallets.sql"));
    await sql.unsafe(migration("0012_driver_commission_debt_limit.sql"));
    await sql.unsafe(migration("0013_trip_payment_methods.sql"));
    await sql.unsafe(migration("0014_passenger_cancellation_penalties.sql"));
    await sql.unsafe(migration("0015_cash_cancellation_debt_settlement.sql"));
    await sql.unsafe(migration("0016_driver_insurance_certificate.sql"));
    await sql.unsafe(migration("0017_trip_ride_type.sql"));
    await sql.unsafe(migration("0018_restrict_shared_rides_table.sql"));
    await sql.unsafe(migration("0019_admin_wallet_withdrawal_review.sql"));
    // Migration 0020 alters Supabase's managed Realtime publication; it is tested in Supabase, not this isolated PostgreSQL fixture.
    await sql.unsafe(migration("0021_driver_documents_storage_bucket.sql"));
    await sql.unsafe(migration("0022_create_trip_optional_defaults.sql"));
    await sql.unsafe(migration("0023_server_derived_night_surcharge.sql"));
    await sql.unsafe(migration("0024_profile_identity_emergency_contact.sql"));
    await sql.unsafe(migration("0025_trip_route_coordinates.sql"));
  }, 20000);
  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE public.trip_events,public.trips,public.user_roles,public.profiles,auth.users CASCADE",
    );
    await sql`UPDATE public.platform_revenue SET balance=0 WHERE id=true`;
    for (const id of [passenger, driverA, driverB, outsider]) {
      await sql`INSERT INTO auth.users(id) VALUES(${id})`;
      await sql`UPDATE public.profiles SET
        first_name='نام',last_name='آزمایشی',display_name='مسافر آزمایشی',
        phone='09000000000',emergency_phone='09111111111',
        car='خودرو آزمایشی',plate='آزمایشی'
        WHERE id=${id}`;
    }
    for (const id of [driverA, driverB]) {
      await sql`INSERT INTO public.user_roles(user_id,role) VALUES(${id},'driver')`;
      await sql`INSERT INTO public.driver_verifications(user_id,status,note)
        VALUES(${id},'approved','تأیید آزمایشی') ON CONFLICT(user_id) DO UPDATE SET status='approved'`;
    }
  });
  afterAll(async () => {
    await sql.end();
  });

  it("stores route endpoints and derives the night surcharge from departure time", async () => {
    const ride = await asUser(passenger, async (tx) => {
      const [row] = await tx`
        SELECT public.create_trip(
          'گرگان','تهران',
          (date_trunc('day',now() AT TIME ZONE 'Asia/Tehran') + interval '1 day 23 hours') AT TIME ZONE 'Asia/Tehran',
          10,false,false,36.84,54.43,35.68,51.38,NULL,'cash','intercity'
        ) AS id
      `;
      return row?.["id"] as string;
    });
    const [row] = await sql`
      SELECT km,night,origin_lat,origin_lng,destination_lat,destination_lng
      FROM public.trips WHERE id=${ride}
    `;
    expect(Number(row?.["km"])).toBe(10);
    expect(row?.["night"]).toBe(true);
    expect(Number(row?.["origin_lat"])).toBeCloseTo(36.84);
    expect(Number(row?.["origin_lng"])).toBeCloseTo(54.43);
    expect(Number(row?.["destination_lat"])).toBeCloseTo(35.68);
    expect(Number(row?.["destination_lng"])).toBeCloseTo(51.38);
  });

  it("requires real name and emergency phone before creating a trip", async () => {
    await sql`UPDATE public.profiles SET emergency_phone='' WHERE id=${passenger}`;
    await expect(create()).rejects.toThrow("شماره اضطراری");
  });

  it("does not allow authenticated users to bypass the trusted trip-creation wrapper", async () => {
    await expect(asUser(passenger, async (tx) => {
      await tx`SELECT public.create_trip(
        'گرگان','تهران',now()+interval '1 day',10,false,false,NULL,'cash'
      )`;
    })).rejects.toThrow();
  });

  it("persists request, name and unchanged 10% commission; both drivers read it", async () => {
    const ride = await create();
    for (const driver of [driverA, driverB]) {
      const rows = await asUser(driver, (tx) => tx`SELECT * FROM public.trips WHERE id=${ride}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["passenger_name"]).toBe("مسافر آزمایشی");
      expect(rows[0]?.["commission"]).toBe(Math.round(rows[0]?.["agreed_fare"] * 0.1));
      expect(rows[0]?.["driver_net"] + rows[0]?.["commission"]).toBe(rows[0]?.["agreed_fare"]);
    }
    expect(await asUser(outsider, (tx) => tx`SELECT id FROM public.trips`)).toHaveLength(0);
  });
  it("rejects self acceptance and unregistered drivers", async () => {
    const own = await create(driverA);
    await expect(change(driverA, own, "accepted")).rejects.toThrow("خودتان");
    const ride = await create();
    await expect(change(outsider, ride, "accepted")).rejects.toThrow("تأیید مدارک");
  });
  it("concurrent drivers produce exactly one assignment and one clear conflict", async () => {
    const ride = await create();
    const results = await Promise.allSettled([
      change(driverA, ride, "accepted"),
      change(driverB, ride, "accepted"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.["status"] === "rejected" && rejected.reason.code).toBe("PT409");
    const [row] = await sql`SELECT driver_id,status FROM public.trips WHERE id=${ride}`;
    expect(row?.["status"]).toBe("accepted");
    const losing = row?.["driver_id"] === driverA ? driverB : driverA;
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
      (await asUser(passenger, (tx) => tx`SELECT status FROM public.trips WHERE id=${ride}`))[0]?.[
        "status"
      ],
    ).toBe("done");
    await expect(change(driverA, ride, "cancelled")).rejects.toThrow("مجاز نیست");
  });

  it("records a 20% cash cancellation debt and pays the 90/10 split after the next trip", async () => {
    const cancelledRide = await create();
    await change(driverA, cancelledRide, "accepted");
    await change(passenger, cancelledRide, "cancelled");

    const [debt] = await sql`
      SELECT penalty_amount,platform_amount,driver_amount,status
      FROM public.passenger_cancellation_debts WHERE source_trip_id=${cancelledRide}
    `;
    const [cancelled] = await sql`SELECT agreed_fare FROM public.trips WHERE id=${cancelledRide}`;
    const penalty = Math.round(Number(cancelled?.["agreed_fare"]) * 0.2);
    expect(Number(debt?.["penalty_amount"])).toBe(penalty);
    expect(Number(debt?.["platform_amount"])).toBe(Math.round(penalty * 0.1));
    expect(Number(debt?.["driver_amount"])).toBe(penalty - Math.round(penalty * 0.1));
    expect(debt?.["status"]).toBe("open");

    const nextRide = await create();
    const [next] = await sql`SELECT prior_debt_amount,commission FROM public.trips WHERE id=${nextRide}`;
    expect(Number(next?.["prior_debt_amount"])).toBe(penalty);

    await change(driverA, nextRide, "accepted");
    await change(driverA, nextRide, "ongoing");
    await change(driverA, nextRide, "done");

    const [settled] = await sql`
      SELECT status,settled_by_trip_id FROM public.passenger_cancellation_debts
      WHERE source_trip_id=${cancelledRide}
    `;
    expect(settled?.["status"]).toBe("settled");
    expect(settled?.["settled_by_trip_id"]).toBe(nextRide);

    const platformShare = Math.round(penalty * 0.1);
    const [platformRemittance] = await sql`
      SELECT amount FROM public.wallet_transactions
      WHERE user_id=${driverA} AND reference_id=${cancelledRide} AND kind='commission'
    `;
    expect(Number(platformRemittance?.["amount"])).toBe(-platformShare);

    const [platform] = await sql`SELECT balance FROM public.platform_revenue WHERE id=true`;
    expect(Number(platform?.["balance"])).toBe(Number(next?.["commission"]) + Math.round(penalty * 0.1));
  });


  it("credits the 90/10 cancellation split once when the next trip is wallet-paid", async () => {
    await sql`UPDATE public.wallet_accounts SET balance=1000000 WHERE user_id=${passenger}`;
    const cancelledRide = await create();
    await change(driverA, cancelledRide, "accepted");
    await change(passenger, cancelledRide, "cancelled");
    const [cancelled] = await sql`SELECT agreed_fare FROM public.trips WHERE id=${cancelledRide}`;
    const penalty = Math.round(Number(cancelled?.["agreed_fare"]) * 0.2);
    const driverShare = penalty - Math.round(penalty * 0.1);
    const platformShare = penalty - driverShare;

    const nextRide = await create(passenger, "wallet");
    await change(driverA, nextRide, "accepted");
    await change(driverA, nextRide, "ongoing");
    await change(driverA, nextRide, "done");

    const [driverPayment] = await sql`
      SELECT amount FROM public.wallet_transactions
      WHERE user_id=${driverA} AND reference_id=${cancelledRide} AND kind='cancellation_penalty'
    `;
    expect(Number(driverPayment?.["amount"])).toBe(driverShare);
    const [platform] = await sql`SELECT balance FROM public.platform_revenue WHERE id=true`;
    const [next] = await sql`SELECT commission FROM public.trips WHERE id=${nextRide}`;
    expect(Number(platform?.["balance"])).toBe(Number(next?.["commission"]) + platformShare);
    const [settled] = await sql`
      SELECT status FROM public.passenger_cancellation_debts WHERE source_trip_id=${cancelledRide}
    `;
    expect(settled?.["status"]).toBe("settled");
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
