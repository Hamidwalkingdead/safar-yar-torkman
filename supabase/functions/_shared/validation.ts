export type Point = { lat: number; lng: number };

export function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && Number.isFinite(point.lat)
    && point.lat >= 24 && point.lat <= 40.5
    && typeof point.lng === "number" && Number.isFinite(point.lng)
    && point.lng >= 43 && point.lng <= 64;
}

export type CreateTripInput = {
  origin: Point;
  destination: Point;
  originName: string;
  destinationName: string;
  departure: string;
  mountain: boolean;
  suggested: number | null;
  paymentMethod: "cash" | "wallet";
  rideType: "urban" | "intercity" | "suburban";
  requestNote: string;
  femaleDriverRequested: boolean;
  forOtherPerson: boolean;
  contactName: string | null;
  contactPhone: string | null;
};

export function parseCreateTripInput(value: unknown): CreateTripInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isPoint(input.origin) || !isPoint(input.destination)) return null;
  if (input.origin.lat === input.destination.lat && input.origin.lng === input.destination.lng) return null;
  if (typeof input.originName !== "string" || input.originName.trim().length < 2 || input.originName.trim().length > 160) return null;
  if (typeof input.destinationName !== "string" || input.destinationName.trim().length < 2 || input.destinationName.trim().length > 160) return null;
  if (typeof input.departure !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.departure) || !Number.isFinite(Date.parse(input.departure))) return null;
  if (typeof input.mountain !== "boolean") return null;
  if (input.suggested !== null && (typeof input.suggested !== "number" || !Number.isSafeInteger(input.suggested) || input.suggested < 80_000 || input.suggested > 2_147_483_647)) return null;
  if (input.paymentMethod !== "cash" && input.paymentMethod !== "wallet") return null;
  if (input.rideType !== "urban" && input.rideType !== "intercity" && input.rideType !== "suburban") return null;
  const requestNote = input.requestNote === undefined ? "" : input.requestNote;
  const femaleDriverRequested = input.femaleDriverRequested === undefined ? false : input.femaleDriverRequested;
  const forOtherPerson = input.forOtherPerson === undefined ? false : input.forOtherPerson;
  const contactName = typeof input.contactName === "string" ? input.contactName.trim() : "";
  const contactPhone = typeof input.contactPhone === "string" ? input.contactPhone.trim() : "";
  if (typeof requestNote !== "string" || requestNote.length > 500
      || typeof femaleDriverRequested !== "boolean" || typeof forOtherPerson !== "boolean") return null;
  if (forOtherPerson && (contactName.length < 2 || contactName.length > 80 || !/^09[0-9]{9}$/.test(contactPhone))) return null;
  return {
    origin: input.origin,
    destination: input.destination,
    originName: input.originName.trim(),
    destinationName: input.destinationName.trim(),
    departure: input.departure,
    mountain: input.mountain,
    suggested: input.suggested as number | null,
    paymentMethod: input.paymentMethod,
    rideType: input.rideType,
    requestNote: requestNote.trim(),
    femaleDriverRequested,
    forOtherPerson,
    contactName: forOtherPerson ? contactName : null,
    contactPhone: forOtherPerson ? contactPhone : null,
  };
}

export function parseRouteInput(value: unknown): { origin: Point; destination: Point } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isPoint(input.origin) || !isPoint(input.destination)) return null;
  if (input.origin.lat === input.destination.lat && input.origin.lng === input.destination.lng) return null;
  return { origin: input.origin, destination: input.destination };
}

export type SharedRideInput = {
  rideType: "intercity";
  origin: Point;
  destination: Point;
  originName: string;
  destinationName: string;
  departure: string;
  seats: number;
  mountain: boolean;
  womenOnly: boolean;
  femaleDriverRequested: boolean;
  forOtherPerson: boolean;
  requestNote: string;
  contactName: string | null;
  contactPhone: string | null;
};

export function parseSharedRideInput(value: unknown): SharedRideInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.rideType !== "intercity") return null;
  if (!isPoint(input.origin) || !isPoint(input.destination)) return null;
  if (input.origin.lat === input.destination.lat && input.origin.lng === input.destination.lng) return null;
  if (typeof input.originName !== "string" || input.originName.trim().length < 2 || input.originName.trim().length > 160) return null;
  if (typeof input.destinationName !== "string" || input.destinationName.trim().length < 2 || input.destinationName.trim().length > 160) return null;
  if (typeof input.departure !== "string"
      || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test(input.departure)
      || !Number.isFinite(Date.parse(input.departure))
      || Date.parse(input.departure) <= Date.now()) return null;
  if (!Number.isInteger(input.seats) || Number(input.seats) < 1 || Number(input.seats) > 3) return null;
  if (typeof input.mountain !== "boolean" || typeof input.womenOnly !== "boolean"
      || typeof input.femaleDriverRequested !== "boolean" || typeof input.forOtherPerson !== "boolean") return null;
  if (typeof input.requestNote !== "string" || input.requestNote.length > 500) return null;
  const contactName = typeof input.contactName === "string" ? input.contactName.trim() : "";
  const contactPhone = typeof input.contactPhone === "string" ? input.contactPhone.trim() : "";
  if (input.forOtherPerson && (contactName.length < 2 || contactName.length > 80 || !/^09[0-9]{9}$/.test(contactPhone))) return null;
  return {
    rideType: "intercity",
    origin: input.origin,
    destination: input.destination,
    originName: input.originName.trim(),
    destinationName: input.destinationName.trim(),
    departure: input.departure,
    seats: Number(input.seats),
    mountain: input.mountain,
    womenOnly: input.womenOnly,
    femaleDriverRequested: input.femaleDriverRequested,
    forOtherPerson: input.forOtherPerson,
    requestNote: input.requestNote.trim(),
    contactName: input.forOtherPerson ? contactName : null,
    contactPhone: input.forOtherPerson ? contactPhone : null,
  };
}
