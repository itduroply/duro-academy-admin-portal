alter table public.user_performance_dashboard
  drop constraint if exists user_performance_dashboard_access_type_check;

alter table public.user_performance_dashboard
  drop constraint if exists user_performance_dashboard_access_types_check;

alter table public.user_performance_dashboard
  add constraint user_performance_dashboard_access_types_check
  check (
    access_type is not null
    and array_length(access_type, 1) > 0
    and access_type <@ array['DGO', 'ASM', 'SM', 'DBM', 'Calculator']::text[]
  );

update public.user_performance_dashboard
set access_type = array(
  select array_agg(distinct value order by value)
  from unnest(coalesce(access_type, array[]::text[])) as value
  where value in ('DGO', 'ASM', 'SM', 'DBM', 'Calculator')
)
where access_type is not null;
