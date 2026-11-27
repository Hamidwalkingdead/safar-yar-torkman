import { describe,it,expect } from "vitest";
import { allocateSharedItinerary, findBestSharedItinerary, type SharedPassengerInput, type SharedStop } from "./shared-itinerary";

const a:SharedPassengerInput={userId:"a",origin:{lat:35,lng:51,name:"مبدأ الف"},destination:{lat:36,lng:52,name:"مقصد الف"},seats:1,mountain:false};
const b:SharedPassengerInput={userId:"b",origin:{lat:35.2,lng:51.2,name:"مبدأ ب"},destination:{lat:36.2,lng:52.2,name:"مقصد ب"},seats:1,mountain:false};
const stop=(p:SharedPassengerInput,kind:"pickup"|"dropoff"):SharedStop=>({...p[kind==="pickup"?"origin":"destination"],userId:p.userId,kind});

describe("shared itinerary fare allocation",()=>{
 it("allocates each driven leg once and charges a new passenger for empty pickup distance",()=>{
  const stops=[stop(a,"pickup"),stop(a,"dropoff"),stop(b,"pickup"),stop(b,"dropoff")];
  const legs=[10,5,20];
  let i=0;
  const result=allocateSharedItinerary([a,b],stops,()=>legs[i++]!,false);
  expect(result.totalDistanceKm).toBe(35);
  expect(result.passengerDistanceKm.a).toBe(10);
  expect(result.passengerDistanceKm.b).toBe(25);
  expect(result.totalFare).toBe(80_000+350_000);
 });
 it("splits shared driving legs among passengers already aboard",()=>{
  const stops=[stop(a,"pickup"),stop(b,"pickup"),stop(a,"dropoff"),stop(b,"dropoff")];
  const legs=[10,20,10];
  let i=0;
  const result=allocateSharedItinerary([a,b],stops,()=>legs[i++]!,false);
  expect(result.totalDistanceKm).toBe(40);
  expect(result.passengerDistanceKm.a).toBe(20);
  expect(result.passengerDistanceKm.b).toBe(20);
 });
 it("does not accept more than three seats",()=>{
  expect(()=>allocateSharedItinerary([{...a,seats:2},{...b,seats:2}],[stop(a,"pickup"),stop(a,"dropoff"),stop(b,"pickup"),stop(b,"dropoff")],()=>10,false)).toThrow();
 });
 it("finds an overlapping itinerary and rejects excessive detours",async()=>{
  const distance=async(from:{lat:number;lng:number},to:{lat:number;lng:number})=>{
   const straight=Math.hypot(from.lat-to.lat,from.lng-to.lng)*100;
   return straight||1;
  };
  const result=await findBestSharedItinerary([a,b],distance,false,10);
  expect(result).not.toBeNull();
  const rejected=await findBestSharedItinerary([a,b],async(from,to)=>from===a.origin&&to===a.destination?10:1000,false,1.1);
  expect(rejected).toBeNull();
 });
});
