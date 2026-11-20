-- Run after dashboard-data.sql. Allows active administrators to upload
-- formation images, videos and PDFs to the formation-files bucket.
insert into storage.buckets (id, name, public)
values ('formation-files', 'formation-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read formation files" on storage.objects;
create policy "Public can read formation files"
    on storage.objects for select to public
    using (bucket_id = 'formation-files');

drop policy if exists "Admins upload formation files" on storage.objects;
create policy "Admins upload formation files"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'formation-files'
        and (storage.foldername(name))[1] = 'formations'
        and (storage.foldername(name))[2] = auth.uid()::text
        and public.dashboard_is_admin()
        and public.dashboard_user_is_active()
    );

drop policy if exists "Admins update formation files" on storage.objects;
create policy "Admins update formation files"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'formation-files'
        and (storage.foldername(name))[1] = 'formations'
        and (storage.foldername(name))[2] = auth.uid()::text
        and public.dashboard_is_admin()
        and public.dashboard_user_is_active()
    )
    with check (
        bucket_id = 'formation-files'
        and (storage.foldername(name))[1] = 'formations'
        and (storage.foldername(name))[2] = auth.uid()::text
        and public.dashboard_is_admin()
        and public.dashboard_user_is_active()
    );

drop policy if exists "Admins delete formation files" on storage.objects;
create policy "Admins delete formation files"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'formation-files'
        and (storage.foldername(name))[1] = 'formations'
        and (storage.foldername(name))[2] = auth.uid()::text
        and public.dashboard_is_admin()
        and public.dashboard_user_is_active()
    );
