-- Admin DBM & SM Performance Dashboard
--
-- Admin versions of the app's get_dbmsm_* functions (DuroAcademy app repo,
-- supabase/migrations/20261026_create_get_dbmsm_*.sql). The app functions take the manager from
-- auth.uid(); these take the manager as a parameter, or return every DBM and SM at once.
-- The rules are the same, so the admin numbers match each manager's own dashboard.
--
-- Downline rule (which mv_pli_performance_monthly rows count for a manager M):
--   direct reportee on DGO -> rows with dashboard_type DGO, scope SELF
--   direct reportee on ASM -> rows with dashboard_type ASM, scope TEAM (MY rows skipped)
--   direct reportee on SM  -> SM's own rows skipped; the DGO/ASM rule is applied to the SM's
--                             direct reportees (one level only - an SM never reports to an SM)
--   M's own rows are never counted
-- Reportee role = first match of SM, ASM, DGO in user_performance_dashboard.access_type
-- (SM as a whole word, so ASM does not count as SM).
--
-- Primary = sales_dump.quantity_pcs for the distinct dealers (dealers.customer_code) mapped to M
-- or anyone below M through users.reporting_manager, capped at 4 levels.
--
-- The rule lives only in the internal _dbmsm_* helpers. authenticated has no execute right on
-- them; they run inside the security definer admin functions.
--
-- Access: users.role must be admin or super_admin. An admin sees only managers in the branches
-- given in performance_dashboard_branch_access (or their own branch if none are given), the same
-- limit the admin panel applies on the other performance dashboards. super_admin sees all.
--
-- Check before use: D10610, Apr-Sep 2026 must give Secondary Count 20607, as on their own dashboard.


-- ============================================================================================
-- Internal helpers
-- ============================================================================================

-- Every user with their dashboard role for the downline rule.
create or replace function public._dbmsm_classified()
returns table (
  id          uuid,
  full_name   text,
  employee_id text,
  manager     text,
  branch_id   bigint,
  access      text,
  role        text
)
language sql
stable
set search_path = public
as $$
  with people as (
    select
      u.id,
      u.full_name::text                as full_name,
      trim(u.employee_id::text)        as employee_id,
      trim(u.reporting_manager::text)  as manager,
      u.branch_id::bigint              as branch_id,
      (select coalesce(string_agg(upper(d.access_type::text), ','), '')
         from user_performance_dashboard d
        where d.user_id = u.id)        as access
    from users u
  )
  select p.*,
    case
      when p.access ~ '(^|[^A-Z])SM([^A-Z]|$)'  then 'SM'
      when p.access ~ '(^|[^A-Z])ASM([^A-Z]|$)' then 'ASM'
      when p.access ~ '(^|[^A-Z])DGO([^A-Z]|$)' then 'DGO'
      else 'NONE'
    end
  from people p;
$$;

-- For every manager: each direct reportee (member) and whose MV rows roll up into that member's
-- line. source_role / source_scope give the MV dashboard_type / scope to take for that source.
-- An SM member with no DGO/ASM reportees has one row with null source_id.
create or replace function public._dbmsm_sources()
returns table (
  manager_id         uuid,
  member_id          uuid,
  member_employee_id text,
  member_name        text,
  member_role        text,
  source_id          uuid,
  source_role        text,
  source_scope       text
)
language sql
stable
set search_path = public
as $$
  with classified as (
    select * from public._dbmsm_classified()
  ),
  l1 as (
    select mgr.id as manager_id, c.*
    from classified c
    join classified mgr on mgr.employee_id = c.manager
    where coalesce(c.manager, '') <> ''
      and c.role in ('DGO', 'ASM', 'SM')
  ),
  links as (
    select l1.manager_id, l1.id as member_id, l1.id as source_id, l1.role as source_role
    from l1
    where l1.role in ('ASM', 'DGO')
    union all
    select sm.manager_id, sm.id, c.id, c.role
    from l1 sm
    join classified c on c.manager = sm.employee_id and c.role in ('ASM', 'DGO')
    where sm.role = 'SM'
  )
  select
    l1.manager_id, l1.id, l1.employee_id, l1.full_name, l1.role,
    lk.source_id, lk.source_role,
    case lk.source_role when 'ASM' then 'TEAM' when 'DGO' then 'SELF' end
  from l1
  left join links lk on lk.manager_id = l1.manager_id and lk.member_id = l1.id;
$$;

-- Primary Count per manager, for the given managers and month starts.
create or replace function public._dbmsm_primary_counts(p_manager_ids uuid[], p_months date[])
returns table (manager_id uuid, primary_count numeric)
language sql
stable
set search_path = public
as $$
  with recursive downline as (
    select u.id as manager_id, trim(u.employee_id::text) as code, 0 as depth
    from users u
    where u.id = any (p_manager_ids)
    union
    select d.manager_id, trim(u.employee_id::text), d.depth + 1
    from users u
    join downline d on trim(u.reporting_manager::text) = d.code
    where d.depth < 4
  ),
  customers as (
    select distinct d.manager_id, trim(dl.customer_code::text) as customer_code
    from downline d
    join dealers dl on trim(dl.employee_id::text) = d.code
    where coalesce(d.code, '') <> ''
      and coalesce(trim(dl.customer_code::text), '') <> ''
  ),
  sales as (
    select trim(s.customer_code::text) as customer_code,
           sum(nullif(trim(s.quantity_pcs::text), '')::numeric) as pcs
    from sales_dump s
    where s.posting_date::date >= (select min(m) from unnest(p_months) m)
      and s.posting_date::date <  (select max(m) from unnest(p_months) m) + interval '1 month'
      and date_trunc('month', s.posting_date::date)::date = any (p_months)
    group by 1
  )
  select c.manager_id, coalesce(sum(sa.pcs), 0)
  from customers c
  join sales sa on sa.customer_code = c.customer_code
  group by c.manager_id;
$$;

-- Branches the caller may see: null = all (super_admin). Raises if the caller is not an admin.
create or replace function public._dbmsm_admin_branch_ids()
returns bigint[]
language plpgsql
stable
set search_path = public
as $$
declare
  v_role   text;
  v_branch bigint;
  v_ids    bigint[];
begin
  select u.role, u.branch_id into v_role, v_branch from users u where u.id = auth.uid();

  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorised';
  end if;

  if v_role = 'super_admin' then
    return null;
  end if;

  select array_agg(a.branch_id) into v_ids
  from performance_dashboard_branch_access a
  where a.user_id = auth.uid();

  return coalesce(v_ids, case when v_branch is null then '{}'::bigint[] else array[v_branch] end);
end;
$$;

-- Raises unless the caller is an admin who may see this manager's branch.
create or replace function public._dbmsm_assert_can_view(p_manager_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_ids bigint[] := public._dbmsm_admin_branch_ids();
begin
  if v_ids is not null and not exists (
    select 1 from users u where u.id = p_manager_id and u.branch_id = any (v_ids)
  ) then
    raise exception 'Not authorised for this manager';
  end if;
end;
$$;

revoke all on function public._dbmsm_classified() from public, anon, authenticated;
revoke all on function public._dbmsm_sources() from public, anon, authenticated;
revoke all on function public._dbmsm_primary_counts(uuid[], date[]) from public, anon, authenticated;
revoke all on function public._dbmsm_admin_branch_ids() from public, anon, authenticated;
revoke all on function public._dbmsm_assert_can_view(uuid) from public, anon, authenticated;


-- ============================================================================================
-- Admin functions
-- ============================================================================================

-- One row per DBM and SM the caller may see, with the totals for the overview table.
-- role = DBM if access_type holds DBM, else SM.
create or replace function public.get_admin_dbmsm_overview(p_months date[])
returns table (
  manager_user_id uuid,
  employee_id     text,
  full_name       text,
  role            text,
  branch_id       bigint,
  branch_name     text,
  member_count    bigint,
  secondary_count numeric,
  primary_count   numeric,
  sheet_points    numeric,
  sheet_goal      numeric,
  dmi_points      numeric,
  dmi_goal        numeric,
  behavior_points numeric,
  behavior_goal   numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_branches bigint[] := public._dbmsm_admin_branch_ids();
begin
  return query
  with managers as (
    select c.id, c.employee_id, c.full_name, c.branch_id,
      case when c.access ~ '(^|[^A-Z])DBM([^A-Z]|$)' then 'DBM' else 'SM' end as mrole
    from public._dbmsm_classified() c
    where (c.access ~ '(^|[^A-Z])DBM([^A-Z]|$)' or c.access ~ '(^|[^A-Z])SM([^A-Z]|$)')
      and (v_branches is null or c.branch_id = any (v_branches))
  ),
  src as (
    select s.* from public._dbmsm_sources() s
    where s.manager_id in (select m.id from managers m)
  ),
  member_counts as (
    select s.manager_id, count(distinct s.member_id) as n from src s group by s.manager_id
  ),
  mv_sums as (
    select s.manager_id,
      sum(mv.approved_sheets)::numeric as secondary,
      sum(mv.sheet_points)::numeric    as sheet_pts,
      sum(mv.sheet_goal)::numeric      as sheet_gl,
      sum(mv.dmi_points)::numeric      as dmi_pts,
      sum(mv.dmi_goal)::numeric        as dmi_gl,
      sum(mv.behavior_points)::numeric as beh_pts,
      sum(mv.behavior_goal)::numeric   as beh_gl
    from src s
    join mv_pli_performance_monthly mv
      on mv.user_id = s.source_id
     and upper(mv.dashboard_type) = s.source_role
     and upper(mv.scope) = s.source_scope
    where mv.month_start = any (p_months)
    group by s.manager_id
  ),
  primary_sums as (
    select p.manager_id, p.primary_count
    from public._dbmsm_primary_counts(array(select m.id from managers m), p_months) p
  )
  select
    m.id, m.employee_id, m.full_name, m.mrole,
    m.branch_id, b.branch_name::text,
    coalesce(mc.n, 0)::bigint,
    coalesce(ms.secondary, 0), coalesce(ps.primary_count, 0),
    coalesce(ms.sheet_pts, 0), coalesce(ms.sheet_gl, 0),
    coalesce(ms.dmi_pts, 0),   coalesce(ms.dmi_gl, 0),
    coalesce(ms.beh_pts, 0),   coalesce(ms.beh_gl, 0)
  from managers m
  left join branches b       on b.id = m.branch_id
  left join member_counts mc on mc.manager_id = m.id
  left join mv_sums ms       on ms.manager_id = m.id
  left join primary_sums ps  on ps.manager_id = m.id
  order by m.full_name;
end;
$$;

-- Sheet Points brand breakdown for one manager. Same columns as get_dbmsm_sheet_breakdown.
create or replace function public.get_admin_dbmsm_sheet_breakdown(p_manager_id uuid, p_months date[])
returns table (
  approved_sheets  numeric,
  claimed_sheets   numeric,
  duro_sheets      numeric,
  duro_vap_sheets  numeric,
  duro_deco_sheets numeric,
  tower_sheets     numeric,
  other_sheets     numeric,
  sheet_points     numeric,
  sheet_goal       numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._dbmsm_assert_can_view(p_manager_id);

  return query
  select
    coalesce(sum(mv.approved_sheets), 0)::numeric,
    coalesce(sum(mv.claimed_sheets), 0)::numeric,
    coalesce(sum(mv.duro_sheets), 0)::numeric,
    coalesce(sum(mv.duro_vap_sheets), 0)::numeric,
    coalesce(sum(mv.duro_deco_sheets), 0)::numeric,
    coalesce(sum(mv.tower_sheets), 0)::numeric,
    coalesce(sum(mv.other_sheets), 0)::numeric,
    coalesce(sum(mv.sheet_points), 0)::numeric,
    coalesce(sum(mv.sheet_goal), 0)::numeric
  from public._dbmsm_sources() s
  join mv_pli_performance_monthly mv
    on mv.user_id = s.source_id
   and upper(mv.dashboard_type) = s.source_role
   and upper(mv.scope) = s.source_scope
  where s.manager_id = p_manager_id
    and mv.month_start = any (p_months);
end;
$$;

-- DMI Points breakdown for one manager. Same columns as get_dbmsm_dmi_breakdown.
create or replace function public.get_admin_dbmsm_dmi_breakdown(p_manager_id uuid, p_months date[])
returns table (
  claimed_dmi_count      numeric,
  active_dmi_count       numeric,
  new_dmi_count          numeric,
  titanium_dmi_count     numeric,
  gold_dmi_count         numeric,
  silver_dmi_count       numeric,
  bronze_dmi_count       numeric,
  base_tier_dmi_count    numeric,
  unknown_tier_dmi_count numeric,
  sheets_for_avg         numeric,
  raw_points             numeric,
  final_raw_points       numeric,
  new_dmi_points         numeric,
  tier_upgrade_count     numeric,
  tier_upgrade_points    numeric,
  dmi_points             numeric,
  dmi_goal               numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._dbmsm_assert_can_view(p_manager_id);

  return query
  select
    coalesce(sum(mv.claimed_dmi_count), 0)::numeric,
    coalesce(sum(mv.active_dmi_count), 0)::numeric,
    coalesce(sum(mv.new_dmi_count), 0)::numeric,
    coalesce(sum(mv.titanium_dmi_count), 0)::numeric,
    coalesce(sum(mv.gold_dmi_count), 0)::numeric,
    coalesce(sum(mv.silver_dmi_count), 0)::numeric,
    coalesce(sum(mv.bronze_dmi_count), 0)::numeric,
    coalesce(sum(mv.base_tier_dmi_count), 0)::numeric,
    coalesce(sum(mv.unknown_tier_dmi_count), 0)::numeric,
    coalesce(sum(mv.sheets_for_avg), 0)::numeric,
    coalesce(sum(mv.raw_points), 0)::numeric,
    coalesce(sum(mv.final_raw_points), 0)::numeric,
    coalesce(sum(mv.new_dmi_points), 0)::numeric,
    coalesce(sum(mv.tier_upgrade_count), 0)::numeric,
    coalesce(sum(mv.tier_upgrade_points), 0)::numeric,
    coalesce(sum(mv.dmi_points), 0)::numeric,
    coalesce(sum(mv.dmi_goal), 0)::numeric
  from public._dbmsm_sources() s
  join mv_pli_performance_monthly mv
    on mv.user_id = s.source_id
   and upper(mv.dashboard_type) = s.source_role
   and upper(mv.scope) = s.source_scope
  where s.manager_id = p_manager_id
    and mv.month_start = any (p_months);
end;
$$;

-- Behavior Points breakdown for one manager, one row per role ('DGO', 'ASM').
-- Same columns as get_dbmsm_behavior_breakdown.
create or replace function public.get_admin_dbmsm_behavior_breakdown(p_manager_id uuid, p_months date[])
returns table (
  role                 text,
  row_count            bigint,
  sgt_goal             numeric,
  sgt_achieved         numeric,
  dmi_site_goal        numeric,
  dmi_site_achieved    numeric,
  war_assigned         numeric,
  war_completed        numeric,
  buddy_assigned       numeric,
  buddy_completed      numeric,
  team_behavior_points numeric,
  team_behavior_goal   numeric,
  behavior_points      numeric,
  behavior_goal        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._dbmsm_assert_can_view(p_manager_id);

  return query
  select
    s.source_role,
    count(*),
    coalesce(sum(mv.sgt_goal), 0)::numeric,
    coalesce(sum(mv.sgt_achieved), 0)::numeric,
    coalesce(sum(mv.dmi_site_goal), 0)::numeric,
    coalesce(sum(mv.dmi_site_achieved), 0)::numeric,
    coalesce(sum(mv.war_assigned), 0)::numeric,
    coalesce(sum(mv.war_completed), 0)::numeric,
    coalesce(sum(mv.buddy_assigned), 0)::numeric,
    coalesce(sum(mv.buddy_completed), 0)::numeric,
    coalesce(sum(mv.team_behavior_points), 0)::numeric,
    coalesce(sum(mv.team_behavior_goal), 0)::numeric,
    coalesce(sum(mv.behavior_points), 0)::numeric,
    coalesce(sum(mv.behavior_goal), 0)::numeric
  from public._dbmsm_sources() s
  join mv_pli_performance_monthly mv
    on mv.user_id = s.source_id
   and upper(mv.dashboard_type) = s.source_role
   and upper(mv.scope) = s.source_scope
  where s.manager_id = p_manager_id
    and mv.month_start = any (p_months)
  group by s.source_role;
end;
$$;

-- Team View list for one manager: one row per direct reportee (an SM row = the sum of the SM's
-- DGO/ASM reportees). Same columns as get_dbmsm_team_members.
create or replace function public.get_admin_dbmsm_team_members(p_manager_id uuid, p_months date[])
returns table (
  user_id         uuid,
  employee_id     text,
  full_name       text,
  role            text,
  row_count       bigint,
  sheet_points    numeric,
  sheet_goal      numeric,
  dmi_points      numeric,
  dmi_goal        numeric,
  behavior_points numeric,
  behavior_goal   numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public._dbmsm_assert_can_view(p_manager_id);

  return query
  select
    s.member_id, s.member_employee_id, s.member_name, s.member_role,
    count(mv.user_id),
    coalesce(sum(mv.sheet_points), 0)::numeric,
    coalesce(sum(mv.sheet_goal), 0)::numeric,
    coalesce(sum(mv.dmi_points), 0)::numeric,
    coalesce(sum(mv.dmi_goal), 0)::numeric,
    coalesce(sum(mv.behavior_points), 0)::numeric,
    coalesce(sum(mv.behavior_goal), 0)::numeric
  from public._dbmsm_sources() s
  left join mv_pli_performance_monthly mv
    on mv.user_id = s.source_id
   and upper(mv.dashboard_type) = s.source_role
   and upper(mv.scope) = s.source_scope
   and mv.month_start = any (p_months)
  where s.manager_id = p_manager_id
  group by s.member_id, s.member_employee_id, s.member_name, s.member_role;
end;
$$;

-- Last MV refresh time, shown on the admin screen.
create or replace function public.get_admin_dbmsm_mv_refreshed_at()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  perform public._dbmsm_admin_branch_ids();
  select max(mv.refreshed_at) into v_at from mv_pli_performance_monthly mv;
  return v_at;
end;
$$;

revoke all on function public.get_admin_dbmsm_overview(date[]) from public, anon;
revoke all on function public.get_admin_dbmsm_sheet_breakdown(uuid, date[]) from public, anon;
revoke all on function public.get_admin_dbmsm_dmi_breakdown(uuid, date[]) from public, anon;
revoke all on function public.get_admin_dbmsm_behavior_breakdown(uuid, date[]) from public, anon;
revoke all on function public.get_admin_dbmsm_team_members(uuid, date[]) from public, anon;
revoke all on function public.get_admin_dbmsm_mv_refreshed_at() from public, anon;

grant execute on function public.get_admin_dbmsm_overview(date[]) to authenticated;
grant execute on function public.get_admin_dbmsm_sheet_breakdown(uuid, date[]) to authenticated;
grant execute on function public.get_admin_dbmsm_dmi_breakdown(uuid, date[]) to authenticated;
grant execute on function public.get_admin_dbmsm_behavior_breakdown(uuid, date[]) to authenticated;
grant execute on function public.get_admin_dbmsm_team_members(uuid, date[]) to authenticated;
grant execute on function public.get_admin_dbmsm_mv_refreshed_at() to authenticated;
