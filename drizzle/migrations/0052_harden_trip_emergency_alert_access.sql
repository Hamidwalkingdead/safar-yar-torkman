drop policy if exists emergency_alert_admin_read on public.trip_emergency_alerts;
drop policy if exists emergency_alert_reporter_read on public.trip_emergency_alerts;
create policy emergency_alert_admin_read on public.trip_emergency_alerts for select to authenticated
using ((select auth.uid()) is not null and coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and public.has_role((select auth.uid()),'admin'));
create policy emergency_alert_reporter_read on public.trip_emergency_alerts for select to authenticated
using ((select auth.uid()) is not null and coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and reporter_id=(select auth.uid()));
create or replace function app_private.admin_update_trip_emergency_alert_internal(p_alert uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not public.has_role(auth.uid(),'admin') then raise exception 'دسترسی محدود'; end if;
 if p_status not in ('acknowledged','resolved') then raise exception 'وضعیت نامعتبر است'; end if;
 update public.trip_emergency_alerts set status=p_status,
 acknowledged_at=case when p_status='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end,
 acknowledged_by=case when p_status='acknowledged' then auth.uid() else acknowledged_by end,
 resolved_at=case when p_status='resolved' then now() else resolved_at end,
 resolved_by=case when p_status='resolved' then auth.uid() else resolved_by end,
 admin_note=left(nullif(trim(p_note),''),500) where id=p_alert;
 if not found then raise exception 'درخواست اضطراری پیدا نشد'; end if;
end; $$;
revoke all on function app_private.admin_update_trip_emergency_alert_internal(uuid,text,text) from public,anon,authenticated;
grant execute on function app_private.admin_update_trip_emergency_alert_internal(uuid,text,text) to authenticated;
create or replace function public.admin_update_trip_emergency_alert(p_alert uuid,p_status text,p_note text default null)
returns void language sql security invoker set search_path=pg_catalog,public,app_private
as $$ select app_private.admin_update_trip_emergency_alert_internal(p_alert,p_status,p_note) $$;
revoke all on function public.admin_update_trip_emergency_alert(uuid,text,text) from public,anon;
grant execute on function public.admin_update_trip_emergency_alert(uuid,text,text) to authenticated;
