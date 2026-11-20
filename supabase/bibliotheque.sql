-- Run after dashboard-data.sql so the dashboard role helpers are available.
create table if not exists public.library_resources (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    author text not null default '',
    category text not null default 'Autres',
    description text not null default '',
    resource_type text not null default 'PDF'
        check (resource_type in ('PDF', 'Livre', 'Vidéo', 'Lien')),
    file_path text,
    external_url text,
    cover_path text,
    cover_url text,
    created_by uuid default auth.uid()
        references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint library_resource_has_content
        check (file_path is not null or external_url is not null)
);

alter table public.library_resources
    add column if not exists cover_path text;

alter table public.library_resources
    drop constraint if exists library_resources_resource_type_check;
alter table public.library_resources
    add constraint library_resources_resource_type_check
    check (resource_type in ('PDF', 'Livre', 'Audio', 'Vidéo', 'Lien'));

alter table public.library_resources enable row level security;
grant select, insert, update, delete on public.library_resources to authenticated;

drop policy if exists "Active users read library resources" on public.library_resources;
create policy "Active users read library resources"
    on public.library_resources for select to authenticated
    using (public.dashboard_user_is_active());

drop policy if exists "Admins add library resources" on public.library_resources;
create policy "Admins add library resources"
    on public.library_resources for insert to authenticated
    with check (
        public.dashboard_is_admin()
        and created_by = auth.uid()
    );

drop policy if exists "Admins update library resources" on public.library_resources;
create policy "Admins update library resources"
    on public.library_resources for update to authenticated
    using (public.dashboard_is_admin())
    with check (public.dashboard_is_admin());

drop policy if exists "Admins delete library resources" on public.library_resources;
create policy "Admins delete library resources"
    on public.library_resources for delete to authenticated
    using (public.dashboard_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'library-files', 'library-files', false, 104857600,
    array[
        'application/pdf',
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac',
        'video/mp4', 'video/webm', 'video/quicktime',
        'image/jpeg', 'image/png', 'image/webp'
    ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active users read library files" on storage.objects;
create policy "Active users read library files"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'library-files'
        and public.dashboard_user_is_active()
    );

drop policy if exists "Admins upload library files" on storage.objects;
create policy "Admins upload library files"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'library-files'
        and (storage.foldername(name))[1] = auth.uid()::text
        and public.dashboard_is_admin()
        and public.dashboard_user_is_active()
    );

drop policy if exists "Admins delete library files" on storage.objects;
create policy "Admins delete library files"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'library-files'
        and public.dashboard_is_admin()
    );
