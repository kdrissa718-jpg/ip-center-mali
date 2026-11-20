-- Run dashboard-data.sql first, then execute this script in the Supabase SQL Editor.
-- It promotes only the Supabase auth user with this exact email address.
do $$
declare
    target_user auth.users%rowtype;
begin
    select *
      into target_user
      from auth.users
     where lower(email) = lower('kdrissa718@gmail.com');

    if not found then
        raise exception 'Aucun compte Supabase Auth ne correspond à kdrissa718@gmail.com.';
    end if;

    insert into public.profiles (id, email, full_name, role, status)
    values (
        target_user.id,
        coalesce(target_user.email, ''),
        coalesce(target_user.raw_user_meta_data ->> 'nom',
                 target_user.raw_user_meta_data ->> 'name', ''),
        'admin',
        'Actif'
    )
    on conflict (id) do update
       set email = excluded.email,
           full_name = case
               when excluded.full_name <> '' then excluded.full_name
               else public.profiles.full_name
           end,
           role = 'admin',
           status = 'Actif',
           updated_at = now();
end;
$$;

select id, email, role, status
from public.profiles
where lower(email) = lower('kdrissa718@gmail.com');
