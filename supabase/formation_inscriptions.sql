-- Run dashboard-data.sql first; the dashboard access helpers are defined there.
create table if not exists public.student_formation_access (
    student_id uuid not null references auth.users(id) on delete cascade,
    formation_id text not null,
    created_at timestamptz not null default now(),
    primary key (student_id, formation_id)
);

alter table public.formations
    add column if not exists is_open boolean not null default true;

alter table public.student_formation_access enable row level security;
grant select, insert, update, delete on public.student_formation_access to authenticated;

drop policy if exists "Students manage own formation access"
    on public.student_formation_access;
create policy "Students manage own formation access"
    on public.student_formation_access for all to authenticated
    using (
        student_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'student'
    )
    with check (
        student_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'student'
        and exists (
            select 1 from public.formations formation
            where formation.id::text = formation_id
              and formation.is_open
        )
    );

drop policy if exists "Admins read formation access"
    on public.student_formation_access;
create policy "Admins read formation access"
    on public.student_formation_access for select to authenticated
    using (public.dashboard_is_admin());
