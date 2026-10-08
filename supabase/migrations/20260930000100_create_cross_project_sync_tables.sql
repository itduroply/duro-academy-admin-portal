create table if not exists public.cross_project_sync_state (
  job_name text primary key,
  last_event_at timestamptz not null default now(),
  last_event_token text,
  is_running boolean not null default false,
  running_since timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.cross_project_sync_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null,
  source_row_count integer not null default 0,
  deleted_row_count integer not null default 0,
  inserted_row_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cross_project_sync_runs_job_created
  on public.cross_project_sync_runs(job_name, created_at desc);

create index if not exists idx_cross_project_sync_runs_status_created
  on public.cross_project_sync_runs(status, created_at desc);

alter table public.cross_project_sync_state enable row level security;
alter table public.cross_project_sync_runs enable row level security;

drop policy if exists "Admin full access sync_state" on public.cross_project_sync_state;
create policy "Admin full access sync_state"
on public.cross_project_sync_state
for all
to authenticated
using (
  exists (
    select 1 from public.users
    where users.id = auth.uid() and users.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.users
    where users.id = auth.uid() and users.role in ('admin', 'super_admin')
  )
);

drop policy if exists "Admin full access sync_runs" on public.cross_project_sync_runs;
create policy "Admin full access sync_runs"
on public.cross_project_sync_runs
for all
to authenticated
using (
  exists (
    select 1 from public.users
    where users.id = auth.uid() and users.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.users
    where users.id = auth.uid() and users.role in ('admin', 'super_admin')
  )
);
