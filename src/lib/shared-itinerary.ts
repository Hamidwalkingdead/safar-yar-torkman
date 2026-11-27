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
  passengerRideDistanceKm: Record<string, number>;
  passengerDirectDistanceKm: Record<string, number>;
  maxPassengerDetourRatio: number;
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

function allValidStopOrders(passengers: SharedPassengerInput[]): SharedStop[][] {
  const stops:SharedStop[]=passengers.flatMap(p=>[
    {...p.origin,userId:p.userId,kind:"pickup" as const},
    {...p.destination,userId:p.userId,kind:"dropoff" as const},
  ]);
  const byId=new Map(passengers.map(p=>[p.userId,p]));
  const results:SharedStop[][]=[];
  const visit=(ordered:SharedStop[],picked:Set<string>,dropped:Set<string>,onboard:Set<string>,seats:number)=>{
    if(ordered.length===stops.length){if(onboard.size===0)results.push(ordered);return;}
    const available=stops.filter(s=>{
      if(s.kind==="pickup")return !picked.has(s.userId)&&!dropped.has(s.userId)&&seats+(byId.get(s.userId)?.seats??0)<=3;
      return onboard.has(s.userId);
    });
    for(const next of available){
      const nextPicked=new Set(picked),nextDropped=new Set(dropped),nextOnboard=new Set(onboard);
      let nextSeats=seats;
      if(next.kind==="pickup"){nextPicked.add(next.userId);nextOnboard.add(next.userId);nextSeats+=byId.get(next.userId)!.seats;}
      else{nextDropped.add(next.userId);nextOnboard.delete(next.userId);nextSeats-=byId.get(next.userId)!.seats;}
      visit([...ordered,next],nextPicked,nextDropped,nextOnboard,nextSeats);
    }
  };
  visit([],new Set(),new Set(),new Set(),0);
  return results;
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
  const passengerIds=passengers.map(p=>p.userId);
  if(new Set(passengerIds).size!==passengerIds.length||passengerIds.some(id=>!id)) throw new Error("شناسه مسافران تکراری یا نامعتبر است");
  const stopCounts=new Map(passengerIds.map(id=>[id,{pickup:0,dropoff:0}]));
  for(const stop of orderedStops){
    const counts=stopCounts.get(stop.userId);
    if(!counts||!Number.isFinite(stop.lat)||!Number.isFinite(stop.lng)||stop.lat<24||stop.lat>40.5||stop.lng<43||stop.lng>64)
      throw new Error("یکی از توقف‌های مسیر نامعتبر است");
    counts[stop.kind]++;
  }
  if(orderedStops.length!==passengers.length*2||[...stopCounts.values()].some(v=>v.pickup!==1||v.dropoff!==1))
    throw new Error("هر مسافر باید دقیقاً یک مبدأ و یک مقصد داشته باشد");
  const seats=passengers.reduce((sum,p)=>sum+p.seats,0);
  if(passengers.some(p=>!Number.isInteger(p.seats)||p.seats<1)||seats>3) throw new Error("ظرفیت سفر اشتراکی حداکثر ۳ نفر است");
  if(orderedStops.length!==passengers.length*2) throw new Error("ترتیب توقف‌های مسیر کامل نیست");
  const byId=new Map(passengers.map(p=>[p.userId,p]));
  const picked=new Set<string>(), dropped=new Set<string>(), onboard=new Set<string>();
  const allocated:Record<string,number>={};
  const ridden:Record<string,number>={};
  for(const p of passengers){allocated[p.userId]=0;ridden[p.userId]=0;}
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
    for(const id of onboard) ridden[id]! += km;
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
  const passengerRideDistanceKm:Record<string,number>={};
  const passengerFare:Record<string,number>={};
  let totalFare=0;
  for(const p of passengers){
    const km=allocated[p.userId]!;
    passengerDistanceKm[p.userId]=Math.round((km/p.seats)*10)/10;
    passengerRideDistanceKm[p.userId]=Math.round((ridden[p.userId]!)*10)/10;
    const fare=fareForAllocatedDistance(km/p.seats,p.mountain,night)*p.seats;
    passengerFare[p.userId]=fare;
    totalFare+=fare;
  }
  return {stops:orderedStops,totalDistanceKm:Math.round(totalDistance*10)/10,passengerDistanceKm,passengerRideDistanceKm,passengerDirectDistanceKm:{},maxPassengerDetourRatio:0,passengerFare,totalFare};
}

export async function findBestSharedItinerary(
  passengers: SharedPassengerInput[],
  getRoadDistanceKm: (from: SharedPoint,to: SharedPoint)=>Promise<number|null>,
  night: boolean,
  maxDetourRatio=1.35,
): Promise<SharedItinerary|null> {
  if(passengers.length<1||passengers.length>3) return null;
  if(new Set(passengers.map(p=>p.userId)).size!==passengers.length)return null;
  const seats=passengers.reduce((sum,p)=>sum+p.seats,0);
  if(seats>3||passengers.some(p=>!Number.isInteger(p.seats)||p.seats<1))return null;

  const routeCache=new Map<string,Promise<number|null>>();
  const keyOf=(a:SharedPoint,b:SharedPoint)=>[a.lat,a.lng,b.lat,b.lng].join(":");
  const distance=(a:SharedPoint,b:SharedPoint)=>{
    const key=keyOf(a,b);
    if(!routeCache.has(key))routeCache.set(key,getRoadDistanceKm(a,b));
    return routeCache.get(key)!;
  };
  const direct=await Promise.all(passengers.map(p=>distance(p.origin,p.destination)));
  if(direct.some(km=>km===null||!Number.isFinite(km)||km<=0))return null;
  const orders=allValidStopOrders(passengers);
  if(!orders.length)return null;
  const pairs=new Map<string,{from:SharedPoint;to:SharedPoint}>();
  for(const stops of orders)for(let i=0;i<stops.length-1;i++){
    const from=stops[i]!,to=stops[i+1]!,key=keyOf(from,to);
    if(!pairs.has(key))pairs.set(key,{from,to});
  }
  await Promise.all([...pairs.values()].map(pair=>distance(pair.from,pair.to)));

  let best:SharedItinerary|null=null;
  let bestWorstDetour=Number.POSITIVE_INFINITY;
  for(const stops of orders){
    const legs=await Promise.all(stops.slice(0,-1).map((stop,i)=>distance(stop,stops[i+1]!)));
    if(legs.some(km=>km===null||!Number.isFinite(km)||km<0))continue;
    let index=0;
    const result=allocateSharedItinerary(passengers,stops,()=>{
      const km=legs[index++];
      if(km===null||km===undefined)throw new Error("قطعه مسیر پیدا نشد");
      return km;
    },night);
    // Limit both the in-car detour and the per-seat amount allocated to a passenger.
    // This prevents a far-away empty pickup from being hidden by a short in-car ride.
    result.passengerDirectDistanceKm=Object.fromEntries(passengers.map((p,i)=>[p.userId,Math.round((direct[i] as number)*100)/100]));
    const ratios=passengers.map((p,i)=>
      Math.max(result.passengerRideDistanceKm[p.userId]!,result.passengerDistanceKm[p.userId]!)/(direct[i] as number)
    );
    if(ratios.some(ratio=>ratio>maxDetourRatio))continue;
    const worst=Math.max(...ratios);
    result.maxPassengerDetourRatio=worst;
    if(!best||worst<bestWorstDetour-0.0001||(Math.abs(worst-bestWorstDetour)<0.0001&&result.totalDistanceKm<best.totalDistanceKm)){
      best=result;bestWorstDetour=worst;
    }
  }
  return best;
}
