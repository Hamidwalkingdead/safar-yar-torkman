export type RideType = "urban" | "intercity" | "suburban";
export const MAX_SHARED_PASSENGERS = 3;
export const MATCH_WINDOW_MINUTES = 60;
export type SharedRide = {
  id: string;
  origin: string;
  destination: string;
  departureAt: string;
  totalFare: number;
  occupied: number;
  state: "open" | "locked" | "confirmed" | "ongoing" | "done" | "cancelled";
  isOwner: boolean;
  allConfirmed: boolean;
  totalDistanceKm?: number | null;
  myBooking: {
    seats: number; confirmed: boolean; amount: number; distanceKm?: number;
    requestNote?: string; womenOnly?: boolean; femaleDriverRequested?: boolean;
    forOtherPerson?: boolean; contactName?: string | null;
  } | null;
};
export const sharedEligible = (type: RideType) => type === "intercity";
export function parsePersianNumber(value: string) {
  return Number(
    value
      .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
      .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
      .replace(/[,٬\s]/g, ""),
  );
}
export function canJoin(occupied: number, seats: number, consent: boolean) {
  return (
    consent &&
    Number.isInteger(seats) &&
    seats >= 1 &&
    occupied >= 0 &&
    occupied + seats <= MAX_SHARED_PASSENGERS
  );
}
export function fareShares(total: number, passengers: number) {
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 3)
    throw new Error("تعداد مسافر نامعتبر است");
  const base = Math.floor(total / passengers);
  return Array.from({ length: passengers }, (_, i) => base + (i < total % passengers ? 1 : 0));
}
export function joiningAmount(total: number, occupied: number, seats: number) {
  return fareShares(total, occupied + seats)
    .slice(occupied)
    .reduce((sum, amount) => sum + amount, 0);
}
export function normalizedPlace(value: string) {
  return value
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f]/g, " ")
    .replace(/[،,؛]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function similarPlace(a: string, b: string) {
  const x = normalizedPlace(a),
    y = normalizedPlace(b);
  if (x.length < 2 || y.length < 2) return false;
  const xt = x.split(" "),
    yt = y.split(" ");
  // Place names are not route coordinates: sharing only the first token
  // (for example, "تهران ونک" and "تهران آزادی") is not a safe match.
  return x === y;
}
export function matchesRide(
  ride: Pick<SharedRide, "origin" | "destination" | "departureAt">,
  origin: string,
  destination: string,
  departure: string,
) {
  const a = new Date(ride.departureAt),
    b = new Date(departure);
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return (
    Number.isFinite(a.getTime()) &&
    Number.isFinite(b.getTime()) &&
    similarPlace(ride.origin, origin) &&
    similarPlace(ride.destination, destination) &&
    day(a) === day(b) &&
    Math.abs(a.getTime() - b.getTime()) <= MATCH_WINDOW_MINUTES * 60000
  );
}
export function departureISO(date: string, time: string) {
  return date && time ? new Date(`${date}T${time}:00+03:30`).toISOString() : "";
}
export function departureLabel(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function waitingDurationLabel(value: string, now = Date.now()) {
  const created = new Date(value).getTime();
  if (!Number.isFinite(created) || created > now) return "زمان انتظار نامشخص";
  const minutes = Math.floor((now - created) / 60000);
  const number = (n: number) => n.toLocaleString("fa-IR");
  if (minutes < 1) return "کمتر از ۱ دقیقه";
  if (minutes < 60) return `${number(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${number(hours)} ساعت و ${number(rest)} دقیقه` : `${number(hours)} ساعت`;
}

export function normalizeIranPhone(value: string) {
  const digits=value
    .replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[\s-]/g,"");
  return digits;
}
