create table if not exists public.user_update_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  changed_by uuid,
  field_name text not null,
  old_value text,
  new_value text,
  change_type text not null default 'update',
  changed_at timestamptz not null default now(),
  constraint user_update_history_user_id_fkey
    foreign key (user_id)
    references public.users(id)
    on delete cascade,
  constraint user_update_history_changed_by_fkey
    foreign key (changed_by)
    references public.users(id)
    on delete set null,
  constraint user_update_history_change_type_check
    check (change_type in ('update', 'email_change', 'password_reset', 'status_toggle'))
);

create index if not exists idx_user_update_history_user_id_changed_at
  on public.user_update_history (user_id, changed_at desc);

create index if not exists idx_user_update_history_changed_by_changed_at
  on public.user_update_history (changed_by, changed_at desc);

alter table public.user_update_history enable row level security;

drop policy if exists "Admin and super_admin can view all user update history" on public.user_update_history;
create policy "Admin and super_admin can view all user update history"
on public.user_update_history
for select
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
);

drop policy if exists "Users can view own update history" on public.user_update_history;
create policy "Users can view own update history"
on public.user_update_history
for select
using (
  user_id = auth.uid()
  or changed_by = auth.uid()
);

drop policy if exists "Admin and super_admin can insert user update history" on public.user_update_history;
create policy "Admin and super_admin can insert user update history"
on public.user_update_history
for insert
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
  and changed_by = auth.uid()
);
