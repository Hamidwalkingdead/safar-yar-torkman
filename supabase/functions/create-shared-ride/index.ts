import { createClient } from "npm:@supabase/supabase-js@2";
import { findBestSharedItinerary, type SharedPassengerInput, type SharedPoint } from "./shared-itinerary.ts";

type Metrics={meters:number;seconds:number};
type CandidateBooking={
 id:string;userId:string;seats:number;origin:string;destination:string;
 originPoint:SharedPoint;destinationPoint:SharedPoint;mountain:boolean;
 womenOnly:boolean;femaleDriverRequested:boolean;requestNote:string;
 forOtherPerson:boolean;contactName:string|null;distanceKm:number|null;fareAmount:number|null;
 displayName:string;
};
type Candidate={id:string;departureAt:string;bookings:CandidateBooking[]};

function validText(v:unknown,max:number){return typeof v==="string"&&v.trim().length>=2&&v.trim().length<=max;}
function nightDeparture(value:string){
 const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tehran",hour:"2-digit",hourCycle:"h23"}).format(new Date(value)));
 return hour>=22||hour<6;
}
async function road(origin:SharedPoint,destination:SharedPoint):Promise<number|null>{
 if(origin.lat===destination.lat&&origin.lng===destination.lng)return 0;
 const key=Deno.env.get("MAPIR_API_KEY")?.trim();
 const coordinates=`${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
 if(key){
  try{
   const response=await fetch(`https://map.ir/routes/route/v1/driving/${coordinates}?alternatives=false&steps=false&overview=false&geometries=polyline6`,{
    headers:{"x-api-key":key,"Mapir-SDK":"reactjs"},signal:AbortSignal.timeout(10000)
   });
   if(response.ok){
    const payload=await response.json() as {code?:string;routes?:Array<{distance?:number}>};
    const meters=Number(payload.routes?.[0]?.distance);
    if(["ok","Ok"].includes(payload.code||"")&&Number.isFinite(meters)&&meters>=0)return meters/1000;
   }
  }catch{/* try Balad fallback */}
 }
 try{
  const response=await fetch(`https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/${coordinates}`,{
   headers:{Origin:"https://balad.ir",Referer:"https://balad.ir/","Accept":"application/json, text/plain, */*","Accept-Language":"fa-IR,fa;q=0.9"},
   signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return null;
  const payload=await response.json() as {code?:string;routes?:Array<{distance?:number}>};
  const meters=Number(payload.code==="Ok"?payload.routes?.[0]?.distance:NaN);
  return Number.isFinite(meters)&&meters>=0?meters/1000:null;
 }catch{return null;}
}
function parseBody(value:unknown){
 if(!value||typeof value!=="object")return null;
 const b=value as Record<string,unknown>;
 if(!isPoint(b.origin)||!isPoint(b.destination))return null;
 if(!validText(b.originName,160)||!validText(b.destinationName,160))return null;
 if(typeof b.departure!=="string"||!Number.isFinite(Date.parse(b.departure))||Date.parse(b.departure)<=Date.now())return null;
 if(!Number.isInteger(b.seats)||Number(b.seats)<1||Number(b.seats)>3)return null;
 if(typeof b.mountain!=="boolean"||typeof b.womenOnly!=="boolean"||typeof b.femaleDriverRequested!=="boolean"||typeof b.forOtherPerson!=="boolean")return null;
 if(typeof b.requestNote!=="string"||b.requestNote.length>500)return null;
 if(b.forOtherPerson&&(!validText(b.contactName,80)||typeof b.contactPhone!=="string"||!/^09\d{9}$/.test(b.contactPhone)))return null;
 if(b.origin.lat===b.destination.lat&&b.origin.lng===b.destination.lng)return null;
 return b as {
  origin:SharedPoint;destination:SharedPoint;originName:string;destinationName:string;departure:string;
  seats:number;mountain:boolean;womenOnly:boolean;femaleDriverRequested:boolean;forOtherPerson:boolean;
  requestNote:string;contactName?:string;contactPhone?:string;
 };
}
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const isPoint=(v:unknown):v is SharedPoint=>!!v&&typeof v==="object"
 && typeof (v as Record<string,unknown>).lat==="number" && Number.isFinite((v as Record<string,number>).lat)
 && (v as Record<string,number>).lat>=24 && (v as Record<string,number>).lat<=40.5
 && typeof (v as Record<string,unknown>).lng==="number" && Number.isFinite((v as Record<string,number>).lng)
 && (v as Record<string,number>).lng>=43 && (v as Record<string,number>).lng<=64;
Deno.serve(async(request)=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return reply({error:"روش درخواست پشتیبانی نمی‌شود."},405);
 try{
  const authorization=request.headers.get("Authorization")??"";
  const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const url=Deno.env.get("SUPABASE_URL");
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!token||!url||!anonKey)return reply({error:"برای ثبت درخواست ابتدا وارد حساب شوید."},401);
  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await authClient.auth.getUser(token);
  if(userError||!userData.user)return reply({error:"نشست کاربری معتبر نیست؛ دوباره وارد شوید."},401);
  const userId=userData.user.id;
  const {data:allowed,error:limitError}=await authClient.rpc("consume_edge_api_rate_limit",{p_endpoint:"shared-match",p_limit:3,p_window_seconds:60});
  if(limitError)throw new Error("کنترل امنیتی درخواست در دسترس نیست؛ عملیات انجام نشد.");
  if(allowed!==true)return reply({error:"تعداد درخواست‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید."},429);
  let raw:unknown;try{raw=await request.json();}catch{return reply({error:"اطلاعات درخواست نامعتبر است."},400);}
  const input=parseBody(raw);if(!input)return reply({error:"مبدأ، مقصد، زمان یا اطلاعات مسافر معتبر نیست."},400);
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)return reply({error:"تنظیمات امن سرور کامل نیست."},500);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:roles,error:roleError}=await admin.from("user_roles").select("role").eq("user_id",userId);
  if(roleError)throw new Error("بررسی نقش مسافر انجام نشد.");
  if(!roles?.some(row=>row.role==="passenger"))return reply({error:"ثبت درخواست سفر فقط از حساب مسافر امکان‌پذیر است."},403);
  const {data:profile,error:profileError}=await admin.from("profiles").select("phone_verified").eq("id",userId).maybeSingle();
  if(profileError)throw new Error("وضعیت تأیید شماره همراه بررسی نشد.");
  if(profile?.phone_verified!==true)return reply({error:"برای ثبت سفر اشتراکی ابتدا شماره همراه خود را با پیامک تأیید کنید."},403);
  const newNight=nightDeparture(input.departure);
  const newPassenger:SharedPassengerInput={
   userId:userId,
   origin:{...input.origin,name:input.originName.trim()},
   destination:{...input.destination,name:input.destinationName.trim()},
   seats:input.seats,mountain:input.mountain
  };
  const {data:candidateData,error:candidateError}=await admin.rpc("shared_route_candidates",{p_departure:input.departure});
  if(candidateError)throw new Error("بررسی هم‌مسیرها انجام نشد.");
  const candidates=(Array.isArray(candidateData)?candidateData:[]) as Candidate[];
  let chosen:{candidate:Candidate;passengers:SharedPassengerInput[];itinerary:Awaited<ReturnType<typeof findBestSharedItinerary>>}|null=null;
  for(const candidate of candidates.slice(0,3)){
   if(candidate.bookings.some(b=>b.userId===userId))return reply({error:"شما برای این مسیر یک درخواست اشتراکی فعال دارید؛ وضعیت همان درخواست را ببینید."},409);
   if(candidate.bookings.some(b=>!b.originPoint||!b.destinationPoint||!Number.isFinite(b.originPoint.lat)||!Number.isFinite(b.destinationPoint.lat)))continue;
   if(candidate.bookings.some(b=>b.womenOnly!==input.womenOnly))continue;
   // Keep female-driver requests together so one passenger's preference is never hidden.
   if(candidate.bookings.some(b=>b.femaleDriverRequested!==input.femaleDriverRequested))continue;
   const occupied=candidate.bookings.reduce((sum,b)=>sum+b.seats,0);
   if(occupied+input.seats>3)continue;
   const passengers:SharedPassengerInput[]=[
    ...candidate.bookings.map(b=>({
     userId:b.userId,
     origin:b.originPoint,
     destination:b.destinationPoint,
     seats:b.seats,
     mountain:b.mountain
    })),
    newPassenger
   ];
   const itinerary=await findBestSharedItinerary(passengers,road,nightDeparture(candidate.departureAt),1.35);
   if(itinerary&&(!chosen||itinerary.totalDistanceKm<chosen.itinerary!.totalDistanceKm)){
    chosen={candidate,passengers,itinerary};
   }
  }
  const selectedPassengers=chosen?.passengers??[newPassenger];
  const itinerary=chosen?.itinerary??await findBestSharedItinerary([newPassenger],road,newNight,1.35);
  if(!itinerary)return reply({error:"مسیر جاده‌ای یکی از توقف‌ها پیدا نشد؛ نقطه‌های مبدأ و مقصد را بررسی کنید."},502);
  if(itinerary.totalFare>2147483647)return reply({error:"مبلغ مسیر از محدوده مجاز بیشتر است."},422);
  const bookingPayload=selectedPassengers.map(p=>{
   const existing=chosen?.candidate.bookings.find(b=>b.userId===p.userId);
   return {
    id:existing?.id??null,userId:p.userId,seats:p.seats,
    origin:p.origin.name,destination:p.destination.name,
    originPoint:{lat:p.origin.lat,lng:p.origin.lng},destinationPoint:{lat:p.destination.lat,lng:p.destination.lng},
    mountain:p.mountain,
    requestNote:existing?.requestNote??input.requestNote,
    womenOnly:existing?.womenOnly??input.womenOnly,
    femaleDriverRequested:existing?.femaleDriverRequested??(p.userId===userId?input.femaleDriverRequested:false),
    forOtherPerson:existing?.forOtherPerson??(p.userId===userId?input.forOtherPerson:false),
    contactName:existing?.contactName??(p.userId===userId?input.contactName??null:null),
    ...(p.userId===userId&&input.forOtherPerson?{contactPhone:input.contactPhone}:{}),
    distanceKm:itinerary.passengerDistanceKm[p.userId],
    fareAmount:itinerary.passengerFare[p.userId]
   };
  });
  const plan=itinerary.stops.map(s=>({kind:s.kind,name:s.name,lat:s.lat,lng:s.lng}));
  const first=itinerary.stops[0]!,last=itinerary.stops[itinerary.stops.length-1]!;
  const {data:rideId,error:createError}=await admin.rpc("create_or_update_shared_route",{
   p_user:userId,p_ride:chosen?.candidate.id??null,p_departure:input.departure,
   p_bookings:bookingPayload,p_route_plan:plan,p_total_distance_km:itinerary.totalDistanceKm,
   p_origin:first.name,p_destination:last.name,
   p_origin_lat:first.lat,p_origin_lng:first.lng,p_destination_lat:last.lat,p_destination_lng:last.lng
  });
  if(createError)throw new Error(createError.message||"ثبت گروه اشتراکی انجام نشد.");
  return reply({
   id:rideId,departureAt:chosen?.candidate.departureAt??input.departure,totalFare:itinerary.totalFare,totalDistanceKm:itinerary.totalDistanceKm,
   myFare:itinerary.passengerFare[userId],myDistanceKm:itinerary.passengerDistanceKm[userId],
   grouped:!!chosen,passengerCount:selectedPassengers.length
  });
 }catch(error){
  console.error("create-shared-ride failed",error);
  return reply({error:error instanceof Error?error.message:"خطای سرور هنگام ثبت سفر اشتراکی رخ داد."},400);
 }
});
