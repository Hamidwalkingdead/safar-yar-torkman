import { assertEquals } from "jsr:@std/assert@1";
import { isPoint, parseCreateTripInput, parseRouteInput } from "./validation.ts";

Deno.test("accepts valid Iran coordinates and rejects coordinates outside Iran", () => {
  assertEquals(isPoint({ lat: 37.25, lng: 55.17 }), true);
  assertEquals(isPoint({ lat: 51.5, lng: -0.1 }), false);
  assertEquals(isPoint({ lat: Number.NaN, lng: 55 }), false);
});

Deno.test("validates trip inputs and requires distinct endpoints", () => {
  const valid = {
    origin: { lat: 37.25, lng: 55.17 },
    destination: { lat: 35.69, lng: 51.39 },
    originName: "گنبد کاووس",
    destinationName: "تهران",
    departure: "2026-11-13T09:00:00.000Z",
    mountain: false,
    suggested: null,
    paymentMethod: "cash",
    rideType: "intercity",
  };
  assertEquals(parseCreateTripInput(valid)?.originName, "گنبد کاووس");
  assertEquals(parseCreateTripInput({ ...valid, suggested: 1000 }), null);
  assertEquals(parseCreateTripInput({ ...valid, destination: valid.origin }), null);
  assertEquals(parseCreateTripInput({ ...valid, departure: "tomorrow" }), null);
});

Deno.test("validates route requests", () => {
  assertEquals(parseRouteInput({
    origin: { lat: 37.25, lng: 55.17 },
    destination: { lat: 35.69, lng: 51.39 },
  }) !== null, true);
  assertEquals(parseRouteInput({ origin: { lat: 37, lng: 55 }, destination: { lat: 37, lng: 55 } }), null);
});
