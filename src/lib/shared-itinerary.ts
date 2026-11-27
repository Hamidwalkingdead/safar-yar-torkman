export type SharedPoint = { lat: number; lng: number; name: string };
export type SharedPassengerInput = {
  userId: string;
  origin: SharedPoint;
  destination: SharedPoint;
  seats: number;
  mountain: boolean;
};
export type SharedStop = SharedPoint & {
  userId: string;
  kind: "pickup" | "dropoff";
};
export type SharedItinerary = {
  stops: SharedStop[];
  totalDistanceKm: number;
  passengerDistanceKm: Record<string, number>;
  passengerFare: Record<string, number>;
  totalFare: number;
};

const MINIMUM_FARE = 80_000;
const STANDARD_RATE = 14_000;
const MOUNTAIN_RATE = 16_000;
const NIGHT_RATE = 1_500;
const LONG_DISTANCE_KM = 300;
const LONG_DISTANCE_RATE = 1_000;

export function fareForAllocatedDistance(km: number, mountain: boolean, night: boolean) {
  const distance = Math.max(0, km);
  const base = distance * (mountain ? MOUNTAIN_RATE : STANDARD_RATE);
  const nightExtra = night ? distance * NIGHT_RATE : 0;
  const longExtra = Math.max(0, distance - LONG_DISTANCE_KM) * LONG_DISTANCE_RATE;
  return Math.max(MINIMUM_FARE, Math.round(base + nightExtra + longExtra));
}

export function straightLineKm(a: SharedPoint, b: SharedPoint) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat), lat2 = rad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function greedyStops(passengers: SharedPassengerInput[], firstUserId: string): SharedStop[] {
  const stops: SharedStop[] = passengers.flatMap(p => [
    { ...p.origin, userId:p.userId, kind:"pickup" as const },
    { ...p.destination, userId:p.userId, kind:"dropoff" as const },
  ]);
  const byId = new Map(passengers.map(p=>[p.userId,p]));
  const visited = new Set<string>();
  const onboard = new Set<string>();
  const ordered: SharedStop[] = [];
  const start = stops.find(s=>s.userId===firstUserId && s.kind==="pickup");
  if (!start) return [];
  ordered.push(start);
  visited.add(`${start.userId}:pickup`);
  onboard.add(start.userId);
  while(ordered.length<stops.length){
    const available=stops.filter(s=>{
      const key=`${s.userId}:${s.kind}`;
      if(visited.has(key)) return false;
      if(s.kind==="dropoff") return onboard.has(s.userId);
      return [...onboard].reduce((sum,id)=>sum+(byId.get(id)?.seats??1),0)+(byId.get(s.userId)?.seats??1) <= 3;
    });
    if(!available.length) return [];
    const current=ordered[ordered.length-1]!;
    available.sort((a,b)=>straightLineKm(current,a)-straightLineKm(current,b));
    const next=available[0]!;
    ordered.push(next);
    visited.add(`${next.userId}:${next.kind}`);
    if(next.kind==="pickup") onboard.add(next.userId);
    else onboard.delete(next.userId);
  }
  return ordered;
}

/**
 * Allocate every driven road leg exactly once. A leg is shared per seat by
 * passengers already aboard and the passenger being collected at its end.
 * If the car is empty, the next passenger bears that pickup approach.
 */
export function allocateSharedItinerary(
  passengers: SharedPassengerInput[],
  orderedStops: SharedStop[],
  legDistanceKm: (from: SharedStop, to: SharedStop) => number,
  night: boolean,
): SharedItinerary {
  if(passengers.length<1 || passengers.length>3) throw new Error("تعداد مسافران اشتراکی نامعتبر است");
  const seats=passengers.reduce((sum,p)=>sum+p.seats,0);
  if(passengers.some(p=>!Number.isInteger(p.seats)||p.seats<1)||seats>3) throw new Error("ظرفیت سفر اشتراکی حداکثر ۳ نفر است");
  if(orderedStops.length!==passengers.length*2) throw new Error("ترتیب توقف‌های مسیر کامل نیست");
  const byId=new Map(passengers.map(p=>[p.userId,p]));
  const picked=new Set<string>(), dropped=new Set<string>(), onboard=new Set<string>();
  const allocated:Record<string,number>={};
  for(const p of passengers) allocated[p.userId]=0;
  let totalDistance=0;
  for(let i=0;i<orderedStops.length;i++){
    const stop=orderedStops[i]!;
    if(!byId.has(stop.userId)) throw new Error("مسافر ناشناس در مسیر وجود دارد");
    if(stop.kind==="pickup"){
      if(picked.has(stop.userId)||dropped.has(stop.userId)) throw new Error("سوارشدن مسافر در ترتیب مسیر نامعتبر است");
      picked.add(stop.userId); onboard.add(stop.userId);
    }else{
      if(!onboard.has(stop.userId)) throw new Error("پیاده‌شدن پیش از سوارشدن مجاز نیست");
      onboard.delete(stop.userId);
      dropped.add(stop.userId);
    }
    if(i===orderedStops.length-1) break;
    const next=orderedStops[i+1]!;
    const km=legDistanceKm(stop,next);
    if(!Number.isFinite(km)||km<0) throw new Error("مسافت یکی از قطعات مسیر معتبر نیست");
    totalDistance+=km;
    const beneficiaries=[...onboard];
    if(next.kind==="pickup"&&!onboard.has(next.userId))beneficiaries.push(next.userId);
    if(beneficiaries.length){
      const beneficiarySeats=beneficiaries.reduce((sum,id)=>sum+(byId.get(id)?.seats??1),0);
      for(const id of beneficiaries) allocated[id]! += km*(byId.get(id)!.seats/beneficiarySeats);
    }else{
      if(next.kind!=="pickup") throw new Error("مسیر خالی باید به نقطه سوارشدن برسد");
      allocated[next.userId]! += km;
    }
  }
  if(onboard.size!==0 || dropped.size!==passengers.length) throw new Error("همه مسافران باید در مقصد خود پیاده شوند");
  const passengerDistanceKm:Record<string,number>={};
  const passengerFare:Record<string,number>={};
  let totalFare=0;
  for(const p of passengers){
    const km=allocated[p.userId]!;
    passengerDistanceKm[p.userId]=Math.round((km/p.seats)*10)/10;
    const fare=fareForAllocatedDistance(km/p.seats,p.mountain,night)*p.seats;
    passengerFare[p.userId]=fare;
    totalFare+=fare;
  }
  return {stops:orderedStops,totalDistanceKm:Math.round(totalDistance*10)/10,passengerDistanceKm,passengerFare,totalFare};
}

export async function findBestSharedItinerary(
  passengers: SharedPassengerInput[],
  getRoadDistanceKm: (from: SharedPoint,to: SharedPoint)=>Promise<number|null>,
  night: boolean,
  maxDetourRatio=1.35,
): Promise<SharedItinerary|null> {
  if(passengers.length<1||passengers.length>3) return null;
  const seats=passengers.reduce((sum,p)=>sum+p.seats,0);
  if(seats>3) return null;
  const direct=await Promise.all(passengers.map(p=>getRoadDistanceKm(p.origin,p.destination)));
  if(direct.some(km=>km===null||!Number.isFinite(km)||km<=0)) return null;
  const maxDirect=Math.max(...direct as number[]);
  let best:SharedItinerary|null=null;
  const routeCache=new Map<string,Promise<number|null>>();
  const distance=async(a:SharedPoint,b:SharedPoint)=>{
    const key=[a.lat,a.lng,b.lat,b.lng].join(":");
    if(!routeCache.has(key)) routeCache.set(key,getRoadDistanceKm(a,b));
    return routeCache.get(key)!;
  };
  for(const first of passengers){
    const stops=greedyStops(passengers,first.userId);
    if(!stops.length) continue;
    const legs:number[]=[];
    let failed=false;
    for(let i=0;i<stops.length-1;i++){
      const km=await distance(stops[i]!,stops[i+1]!);
      if(km===null||!Number.isFinite(km)||km<0){failed=true;break;}
      legs.push(km);
    }
    if(failed) continue;
    let index=0;
    const result=allocateSharedItinerary(passengers,stops,()=>{
      const value=legs[index++];
      if(value===undefined) throw new Error("قطعه مسیر پیدا نشد");
      return value;
    },night);
    if(result.totalDistanceKm>maxDirect*maxDetourRatio) continue;
    if(!best||result.totalDistanceKm<best.totalDistanceKm) best=result;
  }
  return best;
}
