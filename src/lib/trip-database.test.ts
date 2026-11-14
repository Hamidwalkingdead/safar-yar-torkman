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
const admin = "10000000-0000-0000-0000-000000000005";

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
  async function asService<T>(work: (tx: postgres.TransactionSql) => Promise<T>) {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE service_role");
      await tx.unsafe("SELECT set_config('request.jwt.claim.role', 'service_role', true)");
      return work(tx);
    });
    return result as T;
  }
  async function create(id = passenger, paymentMethod: "cash" | "wallet" = "cash", rideType: "urban" | "intercity" | "suburban" = "intercity") {
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
          p_ride_type := ${rideType}
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
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,phone text);
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
    const liveLocationMigration = await migration("0020_private_trip_live_locations.sql");
    await sql.unsafe(liveLocationMigration.replace(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_locations;",
      "-- Supabase-managed Realtime publication is omitted in the isolated PostgreSQL fixture.",
    ));
    await sql.unsafe(migration("0021_driver_documents_storage_bucket.sql"));
    await sql.unsafe(migration("0022_create_trip_optional_defaults.sql"));
    await sql.unsafe(migration("0023_server_derived_night_surcharge.sql"));
    await sql.unsafe(migration("0024_profile_identity_emergency_contact.sql"));
    await sql.unsafe(migration("0025_trip_route_coordinates.sql"));
    await sql.unsafe(migration("0026_pending_passenger_live_location.sql"));
    await sql.unsafe(migration("0027_edge_api_rate_limits.sql"));
    await sql.unsafe(migration("0028_verified_profile_phone.sql"));
    await sql.unsafe(migration("0029_automatic_private_shared_matching.sql"));
    await sql.unsafe(migration("0030_suburban_trip_type.sql"));
    await sql.unsafe(migration("0031_enforce_verified_driver_acceptance.sql"));
    await sql.unsafe(migration("0032_support_ticket_replies.sql"));
    await sql.unsafe(migration("0033_disable_wallet_for_cash_release.sql"));
    await sql.unsafe(migration("0034_shared_ride_chat_and_live_locations.sql"));
    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS extensions");
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions");
    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS vault");
    await sql.unsafe("CREATE TABLE IF NOT EXISTS vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text NOT NULL)");
    await sql.unsafe("CREATE OR REPLACE FUNCTION vault.create_secret(p_secret text,p_name text,p_description text,p_key_id uuid) RETURNS uuid LANGUAGE plpgsql AS $test$ DECLARE secret_id uuid := gen_random_uuid(); BEGIN INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES(p_name,p_secret) ON CONFLICT(name) DO UPDATE SET decrypted_secret=EXCLUDED.decrypted_secret; RETURN secret_id; END; $test$");
    await sql.unsafe(migration("0035_encrypt_emergency_contacts.sql"));
    await sql.unsafe(migration("0036_shared_ride_lifecycle.sql"));
    await sql.unsafe(migration("0037_driver_profile_rating.sql"));
    await sql.unsafe(migration("0038_security_hardening.sql"));
    await sql.unsafe(migration("0039_sequential_private_trip_pickups.sql"));
    await sql.unsafe(migration("0040_guard_sequential_pickup_nesting.sql"));
    await sql.unsafe(migration("0041_server_verified_sequential_pickup.sql"));
    await sql.unsafe(migration("0042_allow_primary_passenger_cancellation.sql"));
    await sql.unsafe(migration("0043_rate_limit_sequential_pickup.sql"));
    await sql.unsafe(migration("0044_rank_enroute_candidates.sql"));
  }, 20000);
  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE public.enroute_trip_links,public.shared_ride_messages,public.shared_ride_locations,public.support_ticket_replies,public.support_tickets,public.shared_bookings,public.shared_rides,public.trip_events,public.trips,public.user_roles,public.driver_documents,storage.objects,public.profile_private_data,public.profiles,auth.users CASCADE",
    );
    await sql`UPDATE public.platform_revenue SET balance=0 WHERE id=true`;
    for (const id of [passenger, driverA, driverB, outsider, admin]) {
      await sql`INSERT INTO auth.users(id,phone) VALUES(${id},'09000000000')`;
      await sql`UPDATE public.profiles SET
        first_name='نام',last_name='آزمایشی',display_name='مسافر آزمایشی',
        emergency_phone='09111111111',
        car='خودرو آزمایشی',plate='آزمایشی'
        WHERE id=${id}`;
    }
    await sql.unsafe("INSERT INTO public.wallet_accounts(user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING");
    await sql.unsafe("UPDATE public.platform_billing_features SET wallet_enabled=true,bank_gateway_enabled=false WHERE id=true");
    for (const id of [driverA, driverB]) {
      await sql`INSERT INTO public.user_roles(user_id,role) VALUES(${id},'driver')`;
      for (const kind of ['car_card','insurance','insurance_certificate','license','car_inside','car_outside','selfie']) {
        const path = id + '/' + kind + '.png';
        await sql`INSERT INTO storage.objects(bucket_id,name) VALUES('driver-documents',${path})`;
        await sql`INSERT INTO public.driver_documents(user_id,kind,path) VALUES(${id},${kind},${path})`;
      }
      await sql`INSERT INTO public.driver_verifications(user_id,status,note)
        VALUES(${id},'approved','تأیید آزمایشی') ON CONFLICT(user_id) DO UPDATE SET status='approved'`;
    }
    await sql`INSERT INTO public.user_roles(user_id,role) VALUES(${admin},'admin')`;
  });
  afterAll(async () => {
    await sql.end();
  });

  it("keeps a pending passenger location private until a driver accepts", async () => {
    const ride = await create();
    await asUser(passenger, async (tx) => {
      await tx`INSERT INTO public.trip_locations(trip_id,user_id,latitude,longitude)
        VALUES(${ride},${passenger},37.25,55.17)`;
    });
    const passengerRows = await asUser(passenger, (tx) =>
      tx`SELECT user_id FROM public.trip_locations WHERE trip_id=${ride}`,
    );
    const hiddenFromDriver = await asUser(driverA, (tx) =>
      tx`SELECT user_id FROM public.trip_locations WHERE trip_id=${ride}`,
    );
    expect(passengerRows).toHaveLength(1);
    expect(hiddenFromDriver).toHaveLength(0);

    await change(driverA, ride, "accepted");
    const visibleToDriver = await asUser(driverA, (tx) =>
      tx`SELECT user_id FROM public.trip_locations WHERE trip_id=${ride}`,
    );
    expect(visibleToDriver).toHaveLength(1);
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

  it("resets driver approval when identity data changes and blocks incomplete admin approval", async () => {
    await asUser(driverA, (tx) => tx.unsafe("SELECT public.clear_my_emergency_phone()"));
    const [verification] = await sql`
      SELECT status FROM public.driver_verifications WHERE user_id=${driverA}
    `;
    expect(verification?.["status"]).toBe("pending");
    await expect(asUser(admin, async (tx) => {
      await tx`SELECT public.admin_review_driver(${driverA},'approved','تأیید آزمایشی')`;
    })).rejects.toThrow("اطلاعات هویتی");
  });

  it("accepts the suburban trip type in the database", async () => {
    const ride = await create(passenger, "cash", "suburban");
    const [row] = await asUser(passenger, (tx) =>
      tx`SELECT ride_type FROM public.trips WHERE id=${ride}`,
    );
    expect(row?.["ride_type"]).toBe("suburban");
  });

  it("limits role lookup to self/admin and hides trigger-only RPCs", async () => {
    const selfCheck = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.has_role('" + passenger + "'::uuid,'admin') AS value"),
    );
    const otherCheck = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.has_role('" + driverA + "'::uuid,'driver') AS value"),
    );
    const adminCheck = await asUser(admin, (tx) =>
      tx.unsafe("SELECT public.has_role('" + driverA + "'::uuid,'driver') AS value"),
    );
    expect(selfCheck[0]?.["value"]).toBe(false);
    expect(otherCheck[0]?.["value"]).toBe(false);
    expect(adminCheck[0]?.["value"]).toBe(true);

    const privileges = await sql.unsafe("SELECT " +
      "has_function_privilege('anon','public.confirm_shared_price(uuid,integer,boolean)','EXECUTE') AS anon_confirm, " +
      "has_function_privilege('authenticated','public.confirm_shared_price(uuid,integer,boolean)','EXECUTE') AS user_confirm, " +
      "has_function_privilege('anon','public.lock_shared_ride(uuid)','EXECUTE') AS anon_lock, " +
      "has_function_privilege('anon','public.create_trip_profile()','EXECUTE') AS anon_profile_trigger, " +
      "has_function_privilege('authenticated','public.record_trip_event()','EXECUTE') AS user_event_trigger, " +
      "has_function_privilege('authenticated','public.reset_driver_verification_on_document_change()','EXECUTE') AS user_document_trigger, " +
      "has_function_privilege('anon','public.has_role(uuid,public.app_role)','EXECUTE') AS anon_role_lookup");
    expect(privileges[0]?.["anon_confirm"]).toBe(false);
    expect(privileges[0]?.["user_confirm"]).toBe(true);
    expect(privileges[0]?.["anon_lock"]).toBe(false);
    expect(privileges[0]?.["anon_profile_trigger"]).toBe(false);
    expect(privileges[0]?.["user_event_trigger"]).toBe(false);
    expect(privileges[0]?.["user_document_trigger"]).toBe(false);
    expect(privileges[0]?.["anon_role_lookup"]).toBe(false);
  });

  it("shows the approved driver's selfie and lets the passenger rate only after completion", async () => {
    const ride = await create();
    await change(driverA, ride, "accepted");
    await change(driverA, ride, "ongoing");
    await change(driverA, ride, "done");

    const contactRows = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.trip_contacts('" + ride + "'::uuid) AS data"),
    );
    const contactData = contactRows[0]?.["data"] as { driver?: {
      photoPath: string; ratingAverage: number | null; ratingCount: number; myRating: number | null;
    } } | undefined;
    const driver = contactData?.driver;
    expect(driver?.photoPath).toBe(driverA + "/selfie.png");
    expect(Number(driver?.ratingCount)).toBe(0);
    expect(driver?.ratingAverage).toBeNull();
    expect(driver?.myRating).toBeNull();

    const canSeePhoto = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.can_view_trip_driver_selfie('" + driver?.photoPath + "') AS allowed"),
    );
    const cannotSeePhoto = await asUser(outsider, (tx) =>
      tx.unsafe("SELECT public.can_view_trip_driver_selfie('" + driver?.photoPath + "') AS allowed"),
    );
    expect(canSeePhoto[0]?.["allowed"]).toBe(true);
    expect(cannotSeePhoto[0]?.["allowed"]).toBe(false);

    await asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.submit_driver_rating('" + ride + "'::uuid,5)");
    });
    const ratedRows = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.trip_contacts('" + ride + "'::uuid) AS data"),
    );
    const ratedData = ratedRows[0]?.["data"] as { driver?: {
      ratingAverage: number; ratingCount: number; myRating: number;
    } } | undefined;
    const ratedDriver = ratedData?.driver;
    expect(Number(ratedDriver?.ratingAverage)).toBe(5);
    expect(Number(ratedDriver?.ratingCount)).toBe(1);
    expect(Number(ratedDriver?.myRating)).toBe(5);

    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.submit_driver_rating('" + ride + "'::uuid,4)");
    })).rejects.toThrow("قبلاً امتیاز");
    await expect(asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.submit_driver_rating('" + ride + "'::uuid,5)");
    })).rejects.toThrow("امتیازدهی فقط برای");
  });

  it("keeps emergency contacts encrypted and returns only the signed-in user's number", async () => {
    await asUser(driverA, async (tx) => {
      await tx.unsafe("UPDATE public.profiles SET emergency_phone='09222222222' WHERE id='" + driverA + "'");
    });

    const passengerData = await asUser(passenger, async (tx) => {
      const [profile] = await tx.unsafe("SELECT emergency_phone FROM public.profiles WHERE id='" + passenger + "'");
      const [phone] = await tx.unsafe("SELECT public.get_my_emergency_phone() AS value");
      return { plaintext: profile?.["emergency_phone"], phone: phone?.["value"] };
    });
    expect(passengerData.plaintext).toBe("");
    expect(passengerData.phone).toBe("09111111111");

    const driverPhone = await asUser(driverA, async (tx) => {
      const [phone] = await tx.unsafe("SELECT public.get_my_emergency_phone() AS value");
      return phone?.["value"];
    });
    expect(driverPhone).toBe("09222222222");

    // The first phone change correctly requires a fresh admin review.
    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_review_driver('" + driverA + "'::uuid,'approved','تأیید شماره اضطراری جدید')");
    });

    await expect(asUser(passenger, (tx) =>
      tx.unsafe("SELECT emergency_phone_ciphertext FROM public.profile_private_data WHERE user_id='" + passenger + "'"),
    )).rejects.toThrow();

    const encryptedRows = await sql.unsafe("SELECT emergency_phone_ciphertext FROM public.profile_private_data WHERE user_id='" + passenger + "'");
    expect(String(encryptedRows[0]?.["emergency_phone_ciphertext"])).not.toContain("09111111111");

    await asUser(driverA, async (tx) => {
      await tx.unsafe("UPDATE public.profiles SET emergency_phone='09222222222' WHERE id='" + driverA + "'");
    });
    const unchangedRows = await sql.unsafe("SELECT status FROM public.driver_verifications WHERE user_id='" + driverA + "'");
    expect(unchangedRows[0]?.["status"]).toBe("approved");

    await asUser(driverA, async (tx) => {
      await tx.unsafe("UPDATE public.profiles SET emergency_phone='09333333333' WHERE id='" + driverA + "'");
    });
    const changedRows = await sql.unsafe("SELECT status FROM public.driver_verifications WHERE user_id='" + driverA + "'");
    expect(changedRows[0]?.["status"]).toBe("pending");

    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_review_driver('" + driverA + "'::uuid,'approved','تأیید پس از ثبت شماره اضطراری رمزنگاری‌شده')");
    });
    const reapprovedRows = await sql.unsafe("SELECT status FROM public.driver_verifications WHERE user_id='" + driverA + "'");
    expect(reapprovedRows[0]?.["status"]).toBe("approved");
  });

  it("requires real name and emergency phone before creating a trip", async () => {
    await asUser(passenger, (tx) => tx.unsafe("SELECT public.clear_my_emergency_phone()"));
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
    await expect(change(outsider, ride, "accepted")).rejects.toThrow("تأیید مدیر");
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

  it("handles sequential private pickups one passenger at a time and returns to the primary trip", async () => {
    const primary = await create();
    await change(driverA, primary, "accepted");
    const secondary = await create(outsider);
    await sql`INSERT INTO public.trip_locations(trip_id,user_id,latitude,longitude)
      VALUES(${primary},${driverA},36.84,54.43)`;

    const snapshot = await asUser(driverA, async (tx) => {
      const [row] = await tx`SELECT public.driver_enroute_candidates(${primary}::uuid) AS data`;
      return row?.["data"] as { candidates?: unknown[] };
    });
    expect(snapshot.candidates).toHaveLength(1);

    const linkId = await asService(async (tx) => {
      const [row] = await tx`SELECT public.accept_enroute_trip_verified(
        ${driverA}::uuid,${primary}::uuid,${secondary}::uuid,2.5,10
      ) AS id`;
      return row?.["id"] as string;
    });
    expect(linkId).toBeTruthy();
    await expect(change(driverA, primary, "ongoing")).rejects.toThrow("ابتدا مسافر بین‌راهی");

    const secondSecondary = await create(passenger);
    await expect(asService(async (tx) => tx`
      SELECT public.accept_enroute_trip_verified(
        ${driverA}::uuid,${primary}::uuid,${secondSecondary}::uuid,1.5,8
      )
    `)).rejects.toThrow("ابتدا مسافر بین‌راهی فعلی");

    await change(driverA, secondary, "ongoing");
    await change(driverA, secondary, "done");
    const [link] = await sql`SELECT state FROM public.enroute_trip_links WHERE id=${linkId}`;
    expect(link?.["state"]).toBe("done");
    await change(driverA, primary, "ongoing");
    await change(driverA, primary, "done");
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

  const requestShared = (user: string, origin: string, destination: string, departure: string, fare: number, seats = 1) =>
    asUser(user, async (tx) => {
      const [row] = await tx`SELECT public.create_shared_ride(
        ${origin},${destination},${departure}::timestamptz,${fare},${seats},'intercity',true
      ) AS id`;
      return row?.["id"] as string;
    });

  it("automatically matches same normalized route within 60 minutes and caps the group at three", async () => {
    const first = await requestShared(passenger, "تهران، ونک", "رشت", "2027-01-10T10:00:00+03:30", 900000, 1);
    const second = await requestShared(driverA, "تهران ونک", "رشت", "2027-01-10T10:45:00+03:30", 950000, 1);
    expect(second).toBe(first);

    const third = await requestShared(driverB, "تهران ونک", "رشت", "2027-01-10T11:00:00+03:30", 920000, 1);
    expect(third).toBe(first);

    const fourth = await requestShared(outsider, "تهران ونک", "رشت", "2027-01-10T10:30:00+03:30", 900000, 1);
    expect(fourth).not.toBe(first);

    const [row] = await asUser(passenger, (tx) =>
      tx`SELECT public.shared_listing() AS data`,
    );
    const ownRides = row?.["data"] as { id: string; state: string; occupied: number }[];
    const matched = ownRides.find((ride) => ride.id === first);
    expect(matched?.state).toBe("locked");
    expect(Number(matched?.occupied)).toBe(3);
  });

  it("does not match different neighborhoods or departures outside the 60-minute window", async () => {
    const first = await requestShared(passenger, "تهران ونک", "رشت", "2027-01-10T10:00:00+03:30", 900000, 1);
    const differentPlace = await requestShared(driverA, "تهران آزادی", "رشت", "2027-01-10T10:15:00+03:30", 900000, 1);
    const differentTime = await requestShared(driverB, "تهران ونک", "رشت", "2027-01-10T11:01:00+03:30", 900000, 1);
    expect(differentPlace).not.toBe(first);
    expect(differentTime).not.toBe(first);
  });

  it("limits shared matching requests to five per user per minute", async () => {
    for (let index = 0; index < 5; index++) {
      await requestShared(passenger, `گرگان ${index}`, "تهران", "2027-01-11T10:00:00+03:30", 900000, 1);
    }
    await expect(
      requestShared(passenger, "گرگان ششم", "تهران", "2027-01-11T10:00:00+03:30", 900000, 1),
    ).rejects.toThrow("تعداد درخواست‌های اشتراکی زیاد است");
  });

  it("returns only a passenger's own shared requests and blocks anonymous catalog access", async () => {
    const ride = await requestShared(passenger, "گرگان", "تهران", "2027-01-10T10:00:00+03:30", 900000, 1);
    await requestShared(driverA, "گرگان", "تهران", "2027-01-10T10:30:00+03:30", 900000, 1);

    const passengerRows = await asUser(passenger, async (tx) => {
      const [row] = await tx`SELECT public.shared_listing() AS data`;
      return row?.["data"] as unknown[];
    });
    const outsiderRows = await asUser(outsider, async (tx) => {
      const [row] = await tx`SELECT public.shared_listing() AS data`;
      return row?.["data"] as unknown[];
    });
    expect(passengerRows).toHaveLength(1);
    expect(outsiderRows).toHaveLength(0);
    expect(passengerRows[0]).toMatchObject({ id: ride, occupied: 2 });

    await expect(sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE anon");
      return tx`SELECT public.shared_listing()`;
    })).rejects.toThrow();
  });


  it("provides private group text/voice chat and live GPS after shared ride acceptance", async () => {
    const ride = await requestShared(passenger, "گرگان", "تهران", "2027-01-12T10:00:00+03:30", 900000, 1);
    await requestShared(outsider, "گرگان", "تهران", "2027-01-12T10:20:00+03:30", 900000, 1);
    const beforeAcceptance = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.shared_driver_status('" + ride + "'::uuid) AS data");
      return row?.["data"];
    });
    expect(beforeAcceptance).toBeNull();

    await asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.accept_shared_ride('" + ride + "'::uuid)");
    });

    const afterAcceptance = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.shared_driver_status('" + ride + "'::uuid) AS data");
      return row?.["data"] as { driverId: string } | null;
    });
    expect(afterAcceptance?.driverId).toBe(driverA);

    await sql.unsafe("INSERT INTO storage.objects(bucket_id,name) VALUES('shared-ride-voice','" + ride + "/" + passenger + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webm')");
    await asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.send_shared_ride_message('" + ride + "'::uuid,'سلام، من مسافر هستم')");
      await tx.unsafe("SELECT public.send_shared_ride_voice('" + ride + "'::uuid,'" + ride + "/" + passenger + "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webm')");
      await tx.unsafe("SELECT public.upsert_shared_ride_location('" + ride + "'::uuid,37.25,55.17,8.0,90.0,2.0)");
    });
    await asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.send_shared_ride_message('" + ride + "'::uuid,'راننده پیام شما را دریافت کرد')");
      await tx.unsafe("SELECT public.upsert_shared_ride_location('" + ride + "'::uuid,37.26,55.18,6.0,95.0,3.0)");
    });

    const messages = await asUser(outsider, (tx) =>
      tx.unsafe("SELECT body,audio_path FROM public.shared_ride_messages WHERE ride_id='" + ride + "'::uuid ORDER BY created_at"),
    );
    expect(messages).toHaveLength(3);
    expect(messages.some((message) => message["body"] === "سلام، من مسافر هستم")).toBe(true);
    expect(messages.some((message) => String(message["audio_path"] ?? "").includes(ride + "/" + passenger + "/"))).toBe(true);

    const locations = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT user_id,latitude,longitude FROM public.shared_ride_locations WHERE ride_id='" + ride + "'::uuid"),
    );
    expect(locations).toHaveLength(2);
    expect(locations.map((row) => row["user_id"]).sort()).toEqual([passenger, driverA].sort());

    const hiddenMessages = await asUser(driverB, (tx) =>
      tx.unsafe("SELECT * FROM public.shared_ride_messages WHERE ride_id='" + ride + "'::uuid"),
    );
    expect(hiddenMessages).toHaveLength(0);
    await expect(asUser(driverB, async (tx) => {
      await tx.unsafe("SELECT public.send_shared_ride_message('" + ride + "'::uuid,'پیام غیرمجاز')");
    })).rejects.toThrow("اعضای همان گروه");
    await expect(asUser(driverB, async (tx) => {
      await tx.unsafe("SELECT public.upsert_shared_ride_location('" + ride + "'::uuid,37.27,55.19)");
    })).rejects.toThrow("اعضای همان گروه");

    const assigned = await asUser(driverA, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.driver_assigned_shared_rides() AS data");
      return row?.["data"] as { id: string }[];
    });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.id).toBe(ride);
  });


  it("starts, completes and closes a shared ride while preserving private chat history", async () => {
    const departure = new Date(Date.now() + 10 * 60_000).toISOString();
    const ride = await requestShared(passenger, "گرگان", "تهران", departure, 900000, 1);

    await asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.accept_shared_ride('" + ride + "'::uuid)");
    });
    await asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.lock_shared_ride('" + ride + "'::uuid)");
      await tx.unsafe("SELECT public.confirm_shared_price('" + ride + "'::uuid,900000,true)");
    });
    await asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.start_shared_ride('" + ride + "'::uuid)");
      await tx.unsafe("SELECT public.send_shared_ride_message('" + ride + "'::uuid,'سفر آغاز شد')");
    });

    const ongoing = await sql.unsafe("SELECT state,started_at FROM public.shared_rides WHERE id='" + ride + "'");
    expect(ongoing[0]?.["state"]).toBe("ongoing");
    expect(ongoing[0]?.["started_at"]).toBeTruthy();

    await asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.complete_shared_ride('" + ride + "'::uuid)");
    });
    const done = await sql.unsafe("SELECT state,completed_at FROM public.shared_rides WHERE id='" + ride + "'");
    expect(done[0]?.["state"]).toBe("done");
    expect(done[0]?.["completed_at"]).toBeTruthy();

    await asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.submit_shared_driver_rating('" + ride + "'::uuid,4)");
    });
    const sharedDriverRows = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.shared_driver_status('" + ride + "'::uuid) AS data"),
    );
    const sharedDriver = sharedDriverRows[0]?.["data"] as { photoPath: string; ratingAverage: number; ratingCount: number; myRating: number };
    expect(sharedDriver.photoPath).toBe(driverA + "/selfie.png");
    expect(Number(sharedDriver.ratingAverage)).toBe(4);
    expect(Number(sharedDriver.ratingCount)).toBe(1);
    expect(Number(sharedDriver.myRating)).toBe(4);

    const sharedPhotoAccess = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT public.can_view_trip_driver_selfie('" + sharedDriver.photoPath + "') AS allowed"),
    );
    const sharedPhotoHidden = await asUser(outsider, (tx) =>
      tx.unsafe("SELECT public.can_view_trip_driver_selfie('" + sharedDriver.photoPath + "') AS allowed"),
    );
    expect(sharedPhotoAccess[0]?.["allowed"]).toBe(true);
    expect(sharedPhotoHidden[0]?.["allowed"]).toBe(false);

    const history = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT body FROM public.shared_ride_messages WHERE ride_id='" + ride + "'::uuid"),
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.["body"]).toBe("سفر آغاز شد");
    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.send_shared_ride_message('" + ride + "'::uuid,'پیام پس از پایان')");
    })).rejects.toThrow("فقط پس از پذیرش راننده");
    await expect(asUser(driverA, async (tx) => {
      await tx.unsafe("SELECT public.upsert_shared_ride_location('" + ride + "'::uuid,37.25,55.17)");
    })).rejects.toThrow("اعضای همان گروه");
  });

  it("allows a passenger to cancel a shared request before the trip starts", async () => {
    const ride = await requestShared(passenger, "گنبد", "تهران", new Date(Date.now() + 60 * 60_000).toISOString(), 900000, 1);
    await asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.cancel_shared_ride('" + ride + "'::uuid,'تغییر برنامه')");
    });
    const cancelled = await sql.unsafe("SELECT state,cancelled_by,cancel_reason FROM public.shared_rides WHERE id='" + ride + "'");
    expect(cancelled[0]?.["state"]).toBe("cancelled");
    expect(cancelled[0]?.["cancelled_by"]).toBe(passenger);
    expect(cancelled[0]?.["cancel_reason"]).toBe("تغییر برنامه");
  });

  it("encrypts emergency contacts at rest and returns plaintext only through the owner RPC", async () => {
    const stored = await sql.unsafe("SELECT emergency_phone FROM public.profiles WHERE id='" + passenger + "'");
    expect(stored[0]?.["emergency_phone"]).toBe("");
    const encrypted = await sql.unsafe("SELECT emergency_phone_ciphertext FROM public.profile_private_data WHERE user_id='" + passenger + "'");
    expect(String(encrypted[0]?.["emergency_phone_ciphertext"] ?? "")).not.toContain("09111111111");
    const decrypted = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.get_my_emergency_phone() AS phone");
      return row?.["phone"];
    });
    expect(decrypted).toBe("09111111111");

    const otherUserPhone = await asUser(outsider, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.get_my_emergency_phone() AS phone");
      return row?.["phone"];
    });
    expect(otherUserPhone).toBe("09111111111");
    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT * FROM public.profile_private_data");
    })).rejects.toThrow();

    await asUser(passenger, async (tx) => {
      await tx.unsafe("UPDATE public.profiles SET emergency_phone='09222222222' WHERE id='" + passenger + "'");
    });
    const updatedPhone = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.get_my_emergency_phone() AS phone");
      return row?.["phone"];
    });
    expect(updatedPhone).toBe("09222222222");
    const [plain] = await sql.unsafe("SELECT emergency_phone FROM public.profiles WHERE id='" + passenger + "'");
    expect(plain?.["emergency_phone"]).toBe("");
  });

  it("rejects unverified profile phone edits and follows verified Auth phone changes", async () => {
    await expect(
      asUser(passenger, (tx) =>
        tx`UPDATE public.profiles SET phone='09123456789' WHERE id=${passenger}`,
      ),
    ).rejects.toThrow("احراز هویت پیامکی");
    await sql`UPDATE auth.users SET phone='+989123456789' WHERE id=${passenger}`;
    const [profile] = await sql`SELECT phone FROM public.profiles WHERE id=${passenger}`;
    expect(profile?.["phone"]).toBe("09123456789");
  });

  it("enforces per-user Edge Function request limits without sharing counters", async () => {
    const consume = (user: string, endpoint: string, limit: number) =>
      asUser(user, async (tx) => {
        const [row] = await tx`SELECT public.consume_edge_api_rate_limit(${endpoint}::text,${limit}::integer,60::integer) AS allowed`;
        return row?.["allowed"] as boolean;
      });
    expect(await consume(passenger, "neshan-route", 2)).toBe(true);
    expect(await consume(passenger, "neshan-route", 2)).toBe(true);
    expect(await consume(passenger, "neshan-route", 2)).toBe(false);
    expect(await consume(driverA, "neshan-route", 2)).toBe(true);
    await expect(consume(passenger, "unknown-endpoint", 2)).rejects.toThrow();
  });


  it("keeps support replies private and allows a passenger and admin to exchange messages", async () => {
    const [ticket] = await asUser(passenger, (tx) =>
      tx.unsafe("INSERT INTO public.support_tickets(subject,category,body) VALUES('مشکل سفر','ایمنی','گزارش اولیه مسافر') RETURNING id"),
    );
    const ticketId = ticket?.["id"] as string;
    const passengerReply = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.reply_support_ticket('" + ticketId + "'::uuid,'توضیح تکمیلی مسافر') AS id");
      return row?.["id"] as string;
    });
    expect(passengerReply).toBeTruthy();

    const adminCanRead = await asUser(admin, (tx) =>
      tx.unsafe("SELECT body FROM public.support_ticket_replies WHERE ticket_id='" + ticketId + "'::uuid ORDER BY created_at"),
    );
    expect(adminCanRead).toHaveLength(1);
    expect(adminCanRead[0]?.["body"]).toBe("توضیح تکمیلی مسافر");

    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.reply_support_ticket('" + ticketId + "'::uuid,'پاسخ کارشناس پشتیبانی')");
    });
    const passengerCanRead = await asUser(passenger, (tx) =>
      tx.unsafe("SELECT sender_id,body FROM public.support_ticket_replies WHERE ticket_id='" + ticketId + "'::uuid ORDER BY created_at"),
    );
    expect(passengerCanRead).toHaveLength(2);
    expect(passengerCanRead[1]?.["body"]).toBe("پاسخ کارشناس پشتیبانی");
    const [status] = await sql.unsafe("SELECT status FROM public.support_tickets WHERE id='" + ticketId + "'::uuid");
    expect(status?.["status"]).toBe("review");

    const outsiderRows = await asUser(outsider, (tx) =>
      tx.unsafe("SELECT * FROM public.support_ticket_replies WHERE ticket_id='" + ticketId + "'::uuid"),
    );
    expect(outsiderRows).toHaveLength(0);
    await expect(asUser(outsider, async (tx) => {
      await tx.unsafe("SELECT public.reply_support_ticket('" + ticketId + "'::uuid,'پیام غیرمجاز')");
    })).rejects.toThrow("دسترسی");
  });

  it("blocks passenger replies after resolution but lets an admin reopen a ticket", async () => {
    const [ticket] = await asUser(passenger, (tx) =>
      tx.unsafe("INSERT INTO public.support_tickets(subject,category,body) VALUES('پیگیری','سایر','گزارش') RETURNING id"),
    );
    const ticketId = ticket?.["id"] as string;
    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_ticket_status('" + ticketId + "'::uuid,'resolved')");
    });
    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.reply_support_ticket('" + ticketId + "'::uuid,'پیام پس از بسته شدن')");
    })).rejects.toThrow("بسته شده");
    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.reply_support_ticket('" + ticketId + "'::uuid,'پیگیری مدیر')");
    });
    const [status] = await sql.unsafe("SELECT status FROM public.support_tickets WHERE id='" + ticketId + "'::uuid");
    expect(status?.["status"]).toBe("review");
  });


  it("runs cash trips without creating or debiting wallet balances when wallet is disabled", async () => {
    await sql.unsafe("UPDATE public.platform_billing_features SET wallet_enabled=false WHERE id=true");
    const disabledFlag = await sql.unsafe("SELECT public.billing_wallet_enabled() AS enabled");
    expect(disabledFlag[0]?.["enabled"]).toBe(false);
    await sql.unsafe("INSERT INTO auth.users(id,phone) VALUES('10000000-0000-0000-0000-000000000006','09000000006')");
    const newWallet = await sql.unsafe("SELECT * FROM public.wallet_accounts WHERE user_id='10000000-0000-0000-0000-000000000006'");
    expect(newWallet).toHaveLength(0);

    const ride = await create(passenger, "cash");
    await change(driverA, ride, "accepted");
    await change(driverA, ride, "ongoing");
    await change(driverA, ride, "done");
    const walletRows = await sql.unsafe("SELECT count(*)::int AS count FROM public.wallet_transactions WHERE reference_id='" + ride + "'");
    expect(Number(walletRows[0]?.["count"])).toBe(0);
    const balance = await sql.unsafe("SELECT balance FROM public.wallet_accounts WHERE user_id='" + driverA + "'");
    expect(Number(balance[0]?.["balance"])).toBe(0);
    await sql.unsafe("UPDATE public.wallet_accounts SET balance=1000000 WHERE user_id='" + passenger + "'");
    await expect(create(passenger, "wallet")).rejects.toThrow("غیرفعال است");
    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.request_wallet_withdrawal(50000,'1234567812345678')");
    })).rejects.toThrow("غیرفعال است");
  });

  it("settles cash cancellation debt without wallet transactions while wallet is disabled", async () => {
    await sql.unsafe("UPDATE public.platform_billing_features SET wallet_enabled=false WHERE id=true");
    const cancelledRide = await create();
    await change(driverA, cancelledRide, "accepted");
    await change(passenger, cancelledRide, "cancelled");
    const debt = await sql.unsafe("SELECT penalty_amount FROM public.passenger_cancellation_debts WHERE source_trip_id='" + cancelledRide + "'");
    expect(Number(debt[0]?.["penalty_amount"])).toBeGreaterThan(0);
    const nextRide = await create();
    await change(driverA, nextRide, "accepted");
    await change(driverA, nextRide, "ongoing");
    await change(driverA, nextRide, "done");
    const settled = await sql.unsafe("SELECT status FROM public.passenger_cancellation_debts WHERE source_trip_id='" + cancelledRide + "'");
    expect(settled[0]?.["status"]).toBe("settled");
    const transactions = await sql.unsafe("SELECT count(*)::int AS count FROM public.wallet_transactions WHERE reference_id='" + cancelledRide + "'");
    expect(Number(transactions[0]?.["count"])).toBe(0);
  });


  it("keeps billing switches admin-only and refuses unsafe wallet shutdown", async () => {
    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_billing_features(false,false)");
    });
    const flags = await asUser(passenger, async (tx) => {
      const [row] = await tx.unsafe("SELECT public.get_billing_features() AS flags");
      return row?.["flags"];
    });
    expect(flags).toMatchObject({ wallet: false, bankGateway: false });

    await expect(asUser(passenger, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_billing_features(true,false)");
    })).rejects.toThrow("دسترسی مدیر");
    await expect(asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_billing_features(true,true)");
    })).rejects.toThrow("درگاه بانکی");

    await asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_billing_features(true,false)");
    });
    await sql.unsafe("UPDATE public.wallet_accounts SET balance=1000000 WHERE user_id='" + passenger + "'");
    const activeWalletTrip = await create(passenger, "wallet");
    await expect(asUser(admin, async (tx) => {
      await tx.unsafe("SELECT public.admin_set_billing_features(false,false)");
    })).rejects.toThrow("سفرهای کیف پولی فعال");
    expect(activeWalletTrip).toBeTruthy();
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

