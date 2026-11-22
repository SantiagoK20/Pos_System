-- Review and apply manually in Supabase project ldegrbnlxjpdrlmxosrj.
-- Assumes RLS is enabled and no kitchen_orders policies exist.
begin;

grant select on table public.kitchen_orders to authenticated;
grant update (status, updated_at) on table public.kitchen_orders to authenticated;

create policy kitchen_orders_firebase_project
on public.kitchen_orders
as restrictive
for all to authenticated
using (
    (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/atecles-grill-pos'
    and (select auth.jwt() ->> 'aud') = 'atecles-grill-pos'
)
with check (
    (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/atecles-grill-pos'
    and (select auth.jwt() ->> 'aud') = 'atecles-grill-pos'
);

create policy kitchen_orders_read
on public.kitchen_orders
as permissive
for select to authenticated
using (
    (select auth.jwt() ->> 'sub') = '0IGUsugLsOYiLt1VkQsGRNWVM0K2'
    or (select auth.jwt() -> 'kitchen_viewer') = 'true'::jsonb
);

create policy kitchen_orders_admin_update
on public.kitchen_orders
as permissive
for update to authenticated
using ((select auth.jwt() ->> 'sub') = '0IGUsugLsOYiLt1VkQsGRNWVM0K2')
with check ((select auth.jwt() ->> 'sub') = '0IGUsugLsOYiLt1VkQsGRNWVM0K2');

commit;
