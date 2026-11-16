/**
 * Compatibility probe only: checks whether native Deno fetch (as used by Supabase
 * Edge Functions) can call Balad's public web-map endpoints.
 * This is NOT production integration and never builds Android APKs.
 */
const SITE = "https://balad.ir";
const DEVICE_ID = crypto.randomUUID();
const APP_SESSION = crypto.randomUUID();
const common = {
  "Origin": SITE,
  "Referer": SITE + "/",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
};
const searchHeaders = {
  ...common,
  "app-session": APP_SESSION,
  "platform": "web",
  "search-session": crypto.randomUUID(),
  "device-id": DEVICE_ID,
};
const center = { lat: 37.25, lng: 55.17 };
function view(lat: number, lng: number, radiusKm: number) {
  const dlat = radiusKm / 111.32;
  const dlng = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const n = lat + dlat, s = lat - dlat, w = lng - dlng, e = lng + dlng;
  return {
    polygon: [[w,n],[e,n],[e,s],[w,s],[w,n]].map(([x,y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join("|"),
    zoom: radiusKm <= 0.5 ? "16" : radiusKm <= 1 ? "15" : radiusKm <= 2 ? "14" : radiusKm <= 5 ? "13" : radiusKm <= 10 ? "12" : "10",
    camera: `${lng.toFixed(6)},${lat.toFixed(6)}`,
  };
}
async function probe(name: string, url: string, headers: Record<string,string>, validate: (v:any)=>boolean) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const bodyText = await response.text();
    let body: any;
    try { body = JSON.parse(bodyText); } catch { body = null; }
    const pass = response.ok && body !== null && validate(body);
    console.log(JSON.stringify({test:name,status:pass?"PASS":"FAIL",http:response.status,contentType:response.headers.get("content-type"),sample:body ?? bodyText.slice(0,180)}));
    return pass;
  } catch (error) {
    console.log(JSON.stringify({test:name,status:"FAIL",error:String(error).slice(0,300)}));
    return false;
  }
}
const s = new URLSearchParams({ text:"گنبد کاووس", ...view(center.lat,center.lng,25) });
const outcomes = [];
outcomes.push(await probe("search", `https://search.raah.ir/v6/?${s}`, searchHeaders,
  v => Array.isArray(v.results)));
const rev = new URLSearchParams({ location: `${center.lng},${center.lat}` });
outcomes.push(await probe("reverse", `https://reverse-geocoding.raah.ir/v1?${rev}`, common,
  v => typeof v.formatted_address === "string" && v.formatted_address.length > 0));
const route = "https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/55.17,37.25;54.4393,36.8456";
outcomes.push(await probe("route", route, common,
  v => v.code === "Ok" && Array.isArray(v.routes) && v.routes.length > 0));
const passed = outcomes.filter(Boolean).length;
console.log(JSON.stringify({summary:{passed,total:outcomes.length,failed:outcomes.length-passed}}));
if (passed !== outcomes.length) Deno.exit(1);
