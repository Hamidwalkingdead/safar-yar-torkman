create table public.trip_emergency_alerts (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 alert_type text not null check (alert_type in ('accident','threat')),
 latitude double precision, longitude double precision, location_accuracy_m double precision,
 status text not null default 'open' check (status in ('open','acknowledged','resolved')),
 created_at timestamptz not null default now(),
 acknowledged_at timestamptz, acknowledged_by uuid references auth.users(id),
 resolved_at timestamptz, resolved_by uuid references auth.users(id), admin_note text,
 constraint emergency_coordinates_pair check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);
create index trip_emergency_alerts_status_created_idx on public.trip_emergency_alerts(status,created_at desc);
create index trip_emergency_alerts_trip_idx on public.trip_emergency_alerts(trip_id,created_at desc);
alter table public.trip_emergency_alerts enable row level security;
revoke all on public.trip_emergency_alerts from anon,authenticated;
grant select on public.trip_emergency_alerts to authenticated;
create policy emergency_alert_admin_read on public.trip_emergency_alerts for select to authenticated using (public.has_role((select auth.uid()),'admin'));
create policy emergency_alert_reporter_read on public.trip_emergency_alerts for select to authenticated using (reporter_id=(select auth.uid()));
create or replace function app_private.create_trip_emergency_alert(p_trip uuid,p_type text,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare v_trip public.trips; v_id uuid; v_lat double precision; v_lng double precision; v_accuracy double precision;
begin
 if auth.uid() is null then raise exception 'ابتدا وارد حساب شوید'; end if;
 if p_type not in ('accident','threat') then raise exception 'نوع درخواست اضطراری نامعتبر است'; end if;
 select * into v_trip from public.trips where id=p_trip;
 if not found or auth.uid() not in (v_trip.passenger_id,v_trip.driver_id) then raise exception 'فقط اعضای همین سفر می‌توانند درخواست اضطراری ثبت کنند'; end if;
 if v_trip.status not in ('accepted','ongoing') then raise exception 'درخواست اضطراری فقط برای سفر پذیرفته‌شده یا درحال‌اجرا فعال است'; end if;
 if p_lat is not null and (p_lat < -90 or p_lat > 90) then raise exception 'مختصات مکان نامعتبر است'; end if;
 if p_lng is not null and (p_lng < -180 or p_lng > 180) then raise exception 'مختصات مکان نامعتبر است'; end if;
 if (p_lat is null) <> (p_lng is null) then raise exception 'مختصات ناقص است'; end if;
 v_lat:=p_lat; v_lng:=p_lng; v_accuracy:=p_accuracy;
 if v_lat is null then select latitude,longitude,accuracy_m into v_lat,v_lng,v_accuracy from public.trip_locations where trip_id=p_trip and user_id=auth.uid() order by updated_at desc limit 1; end if;
 if exists(select 1 from public.trip_emergency_alerts where trip_id=p_trip and reporter_id=auth.uid() and status<>'resolved' and created_at>now()-interval '60 seconds') then
  select id into v_id from public.trip_emergency_alerts where trip_id=p_trip and reporter_id=auth.uid() and status<>'resolved' order by created_at desc limit 1; return v_id;
 end if;
 insert into public.trip_emergency_alerts(trip_id,reporter_id,alert_type,latitude,longitude,location_accuracy_m) values(p_trip,auth.uid(),p_type,v_lat,v_lng,v_accuracy) returning id into v_id; return v_id;
end; $$;
revoke all on function app_private.create_trip_emergency_alert(uuid,text,double precision,double precision,double precision) from public,anon,authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.create_trip_emergency_alert(uuid,text,double precision,double precision,double precision) to authenticated;
create or replace function public.create_trip_emergency_alert(p_trip uuid,p_type text,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null)
returns uuid language sql security invoker set search_path=pg_catalog,public,app_private as $$ select app_private.create_trip_emergency_alert(p_trip,p_type,p_lat,p_lng,p_accuracy) $$;
revoke all on function public.create_trip_emergency_alert(uuid,text,double precision,double precision,double precision) from public,anon;
grant execute on function public.create_trip_emergency_alert(uuid,text,double precision,double precision,double precision) to authenticated;
create or replace function public.admin_update_trip_emergency_alert(p_alert uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'admin') then raise exception 'دسترسی محدود'; end if;
 if p_status not in ('acknowledged','resolved') then raise exception 'وضعیت نامعتبر است'; end if;
 update public.trip_emergency_alerts set status=p_status,
 acknowledged_at=case when p_status='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end,
 acknowledged_by=case when p_status='acknowledged' then auth.uid() else acknowledged_by end,
 resolved_at=case when p_status='resolved' then now() else resolved_at end,
 resolved_by=case when p_status='resolved' then auth.uid() else resolved_by end,
 admin_note=left(nullif(trim(p_note),''),500) where id=p_alert;
 if not found then raise exception 'درخواست اضطراری پیدا نشد'; end if;
end; $$;
revoke all on function public.admin_update_trip_emergency_alert(uuid,text,text) from public,anon;
grant execute on function public.admin_update_trip_emergency_alert(uuid,text,text) to authenticated;
