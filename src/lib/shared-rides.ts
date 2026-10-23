export type RideType = "urban" | "intercity";
export const MAX_SHARED_PASSENGERS = 3;
export const MATCH_WINDOW_MINUTES = 60;
export type SharedRide = {
  id: string;
  origin: string;
  destination: string;
  departureAt: string;
  totalFare: number;
  occupied: number;
  state: "open" | "locked" | "confirmed";
  isOwner: boolean;
  allConfirmed: boolean;
  myBooking: { seats: number; confirmed: boolean; amount: number } | null;
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
  return x === y || (xt[0] === yt[0] && (xt.length > 1 || yt.length > 1));
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
