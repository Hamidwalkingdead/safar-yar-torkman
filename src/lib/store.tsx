import { createContext, useContext, useState, type ReactNode } from "react";

export type TripStatus = "pending" | "accepted" | "ongoing" | "done" | "cancelled";
export type Trip = {
  id: string;
  passengerName: string;
  passengerPhone: string;
  from: string;
  to: string;
  km: number;
  night: boolean;
  mountain: boolean;
  calculated: number;
  suggested?: number | undefined;
  status: TripStatus;
  driver?: { name: string; phone: string; car: string; plate: string };
};
export type Ticket = { id: string; subject: string; category: string; body: string; status: "open" | "review" | "resolved"; date: string };

export const ME_DRIVER = { name: "رضا کریمی", phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹", car: "پژو ۲۰۶ سفید", plate: "۲۴ ج ۵۸۱ — ایران ۱۱" };
export const ME_PASSENGER = { name: "سارا احمدی", phone: "۰۹۳۵ ۱۱۲ ۴۴۷۰" };

const demoTrips: Trip[] = [
  { id: "T-1042", passengerName: "مهدی رستمی", passengerPhone: "۰۹۱۹ ۸۸۲ ۳۳۱۰", from: "میدان آزادی", to: "فرودگاه امام", km: 42, night: false, mountain: false, calculated: 588000, suggested: 550000, status: "pending" },
  { id: "T-1043", passengerName: "نگار صادقی", passengerPhone: "۰۹۱۲ ۵۵۰ ۹۸۱۲", from: "تجریش", to: "دربند", km: 6, night: true, mountain: true, calculated: 105000, status: "pending" },
  { id: "T-1044", passengerName: "علی موسوی", passengerPhone: "۰۹۰۱ ۷۷۳ ۲۰۰۴", from: "تهران، ترمینال غرب", to: "رشت", km: 325, night: true, mountain: true, calculated: 325 * 17500 + 25000, status: "pending" },
];
const demoTickets: Ticket[] = [
  { id: "S-301", subject: "اختلاف در کرایه سفر", category: "کرایه", body: "مبلغ نهایی با برآورد فرق داشت.", status: "review", date: "۲۵ مهر" },
  { id: "S-288", subject: "جاماندن کیف در خودرو", category: "اشیای گمشده", body: "کیف مشکی روی صندلی عقب.", status: "resolved", date: "۱۸ مهر" },
];

type Ctx = {
  trips: Trip[];
  tickets: Ticket[];
  addTrip: (t: Omit<Trip, "id" | "status" | "passengerName" | "passengerPhone">) => string;
  setStatus: (id: string, s: TripStatus) => void;
  accept: (id: string) => void;
  addTicket: (t: Omit<Ticket, "id" | "status" | "date">) => void;
};
const C = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState(demoTrips);
  const [tickets, setTickets] = useState(demoTickets);
  const v: Ctx = {
    trips,
    tickets,
    addTrip: (t) => {
      const id = `T-${1045 + trips.length}`;
      setTrips((p) => [{ ...t, id, status: "pending", passengerName: ME_PASSENGER.name, passengerPhone: ME_PASSENGER.phone }, ...p]);
      return id;
    },
    setStatus: (id, s) => setTrips((p) => p.map((x) => (x.id === id ? { ...x, status: s } : x))),
    accept: (id) => setTrips((p) => p.map((x) => (x.id === id ? { ...x, status: "accepted", driver: ME_DRIVER } : x))),
    addTicket: (t) => setTickets((p) => [{ ...t, id: `S-${310 + p.length}`, status: "open", date: "امروز" }, ...p]),
  };
  return <C.Provider value={v}>{children}</C.Provider>;
}
export const useStore = () => {
  const c = useContext(C);
  if (!c) throw new Error("no store");
  return c;
};
export const statusLabel: Record<TripStatus, string> = {
  pending: "در انتظار راننده", accepted: "پذیرفته شد", ongoing: "در حال سفر", done: "پایان یافته", cancelled: "لغو شده",
};
