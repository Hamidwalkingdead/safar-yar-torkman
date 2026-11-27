import { createClient } from "npm:@supabase/supabase-js@2";

type Point={lat:number;lng:number};
function isPoint(v:unknown):v is Point{
 if(!v||typeof v!=="object")return false;
 const p=v as Record<string,unknown>;
 return typeof p.lat==="number"&&Number.isFinite(p.lat)&&p.lat>=24&&p.lat<=40.5
  &&typeof p.lng==="number"&&Number.isFinite(p.lng)&&p.lng>=43&&p.lng<=64;
}
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
async function road(origin:Point,destination:Point):Promise<number|null>{
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
  }catch{/* Balad fallback */}
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
Deno.serve(async(request)=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return reply({error:"روش درخواست پشتیبانی نمی‌شود."},405);
 try{
  const authorization=request.headers.get("Authorization")??"";
  const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const url=Deno.env.get("SUPABASE_URL");
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!token||!url||!anonKey||!serviceKey)return reply({error:"نشست یا تنظیمات امن سرور معتبر نیست."},401);
  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await authClient.auth.getUser(token);
  if(userError||!userData.user)return reply({error:"نشست کاربری معتبر نیست؛ دوباره وارد شوید."},401);
  const {data:allowed,error:limitError}=await authClient.rpc("consume_edge_api_rate_limit",{p_endpoint:"shared-match",p_limit:3,p_window_seconds:60});
  if(limitError)throw new Error("کنترل امنیتی درخواست در دسترس نیست.");
  if(allowed!==true)return reply({error:"تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید."},429);
  let body:unknown;try{body=await request.json();}catch{return reply({error:"درخواست نامعتبر است."},400);}
  if(!body||typeof body!=="object")return reply({error:"اطلاعات پذیرش نامعتبر است."},400);
  const input=body as Record<string,unknown>;
  if(typeof input.rideId!=="string"||!/^[0-9a-f-]{36}$/i.test(input.rideId)||!isPoint(input.driverPosition))
   return reply({error:"شناسه سفر یا موقعیت GPS راننده معتبر نیست."},400);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ride,error:rideError}=await admin.from("shared_rides").select("route_plan,departure_at,state,driver_id").eq("id",input.rideId).maybeSingle();
  if(rideError||!ride)return reply({error:"گروه اشتراکی پیدا نشد."},404);
  if(ride.driver_id||!["open","locked"].includes(ride.state)||new Date(ride.departure_at).getTime()<=Date.now())
   return reply({error:"این گروه قبلاً پذیرفته شده یا دیگر فعال نیست."},409);
  const stops=Array.isArray(ride.route_plan)?ride.route_plan as Array<Record<string,unknown>>:[];
  const firstPickup=stops.find(s=>s.kind==="pickup");
  if(!firstPickup||typeof firstPickup.lat!=="number"||typeof firstPickup.lng!=="number")
   return reply({error:"نقطه نخست سوارشدن در مسیر گروه مشخص نیست."},422);
  const approachKm=await road(input.driverPosition as Point,{lat:firstPickup.lat,lng:firstPickup.lng});
  if(approachKm===null)return reply({error:"مسیر جاده‌ای از موقعیت راننده تا نخستین مبدأ پیدا نشد؛ GPS را بررسی کنید."},502);
  const {error:acceptError}=await admin.rpc("accept_shared_ride_with_approach",{
   p_ride:input.rideId,p_driver:userData.user.id,
   p_driver_lat:(input.driverPosition as Point).lat,p_driver_lng:(input.driverPosition as Point).lng,
   p_approach_km:approachKm
  });
  if(acceptError)throw new Error(acceptError.message||"پذیرش گروه انجام نشد.");
  const {data:updated,error:updatedError}=await admin.from("shared_rides").select("total_fare").eq("id",input.rideId).single();
  if(updatedError)throw new Error("پذیرش انجام شد، اما دریافت کرایه به‌روز ممکن نشد.");
  return reply({ok:true,approachKm:Math.round(approachKm*10)/10,totalFare:updated.total_fare});
 }catch(error){
  console.error("accept-shared-ride failed",error);
  return reply({error:error instanceof Error?error.message:"پذیرش سفر اشتراکی انجام نشد."},400);
 }
});
