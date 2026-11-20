-- Base dashboard schema. The existing public.formations table must already exist.
-- Run this file first; admin roles stay restricted to trusted admin tooling.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text not null default '',
    role text not null default 'student'
        check (role in ('admin', 'teacher', 'student')),
    status text not null default 'Actif'
        check (status in ('Actif', 'Bloqué')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles
    add column if not exists email text not null default '',
    add column if not exists full_name text not null default '',
    add column if not exists role text not null default 'student'
        check (role in ('admin', 'teacher', 'student')),
    add column if not exists status text not null default 'Actif'
        check (status in ('Actif', 'Bloqué')),
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

-- Older installations may have a role check that accepts localized role
-- names (for example, 'professeur') but rejects the canonical 'teacher'.
-- Remove it before reconciling auth users, normalize known legacy values,
-- then enforce the role names used by the application.
alter table public.profiles
    drop constraint if exists profiles_role_check;

update public.profiles
   set role = case lower(trim(role))
       when 'professeur' then 'teacher'
       when 'prof' then 'teacher'
       when 'etudiant' then 'student'
       when 'étudiant' then 'student'
       when 'eleve' then 'student'
       when 'élève' then 'student'
       when 'administrateur' then 'admin'
       else lower(trim(role))
   end
 where role is distinct from lower(trim(role))
    or lower(trim(role)) in ('professeur', 'prof', 'etudiant', 'étudiant', 'eleve', 'élève', 'administrateur');

alter table public.profiles
    add constraint profiles_role_check
    check (role in ('admin', 'teacher', 'student'));

create or replace function public.dashboard_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false)
        or exists (
            select 1
            from public.profiles
            where id = auth.uid()
              and role = 'admin'
        );
$$;

create or replace function public.dashboard_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and status = 'Actif'
    );
$$;

create or replace function public.dashboard_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when public.dashboard_is_admin() then 'admin'
        else coalesce(
            (
                select role
                from public.profiles
                where id = auth.uid()
                  and role in ('teacher', 'student')
            ),
            'student'
        )
    end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    requested_role text;
begin
    requested_role := case
        when new.raw_app_meta_data ->> 'role' in ('admin', 'teacher', 'student')
            then new.raw_app_meta_data ->> 'role'
        when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher'
        else 'student'
    end;

    insert into public.profiles (id, email, full_name, role)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data ->> 'nom', new.raw_user_meta_data ->> 'name', ''),
        requested_role
    )
    on conflict (id) do update
    set email = excluded.email,
        full_name = case
            when excluded.full_name <> '' then excluded.full_name
            else public.profiles.full_name
        end;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.sync_profile_role_from_trusted_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    trusted_role text := new.raw_app_meta_data ->> 'role';
begin
    if trusted_role is null
       or trusted_role not in ('admin', 'teacher', 'student') then
        return new;
    end if;

    insert into public.profiles (id, email, full_name, role)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data ->> 'nom',
                 new.raw_user_meta_data ->> 'name', ''),
        trusted_role
    )
    on conflict (id) do update
       set email = excluded.email,
           role = excluded.role,
           full_name = case
               when excluded.full_name <> '' then excluded.full_name
               else public.profiles.full_name
           end;

    return new;
end;
$$;

drop trigger if exists on_auth_app_metadata_role_updated on auth.users;
create trigger on_auth_app_metadata_role_updated
after update of raw_app_meta_data on auth.users
for each row
when (new.raw_app_meta_data is distinct from old.raw_app_meta_data)
execute function public.sync_profile_role_from_trusted_app_metadata();

insert into public.profiles (id, email, full_name, role)
select
    id,
    coalesce(email, ''),
    coalesce(raw_user_meta_data ->> 'nom', raw_user_meta_data ->> 'name', ''),
    case
        when raw_app_meta_data ->> 'role' in ('admin', 'teacher', 'student')
            then raw_app_meta_data ->> 'role'
        when raw_user_meta_data ->> 'role' = 'teacher' then 'teacher'
        else 'student'
    end
from auth.users
on conflict (id) do nothing;

-- Reconcile roles assigned by the Auth Admin API and teacher self-registration.
update public.profiles profile
   set role = case
           when auth_user.raw_app_meta_data ->> 'role' in ('admin', 'teacher', 'student')
               then auth_user.raw_app_meta_data ->> 'role'
           else 'teacher'
       end,
       email = coalesce(auth_user.email, profile.email),
       updated_at = now()
  from auth.users auth_user
 where auth_user.id = profile.id
   and (
       auth_user.raw_app_meta_data ->> 'role' in ('admin', 'teacher', 'student')
       or auth_user.raw_user_meta_data ->> 'role' = 'teacher'
   )
   and profile.role is distinct from case
       when auth_user.raw_app_meta_data ->> 'role' in ('admin', 'teacher', 'student')
           then auth_user.raw_app_meta_data ->> 'role'
       else 'teacher'
   end;

alter table public.profiles enable row level security;
grant select, update on public.profiles to authenticated;

drop policy if exists "Users read own or admin reads all profiles" on public.profiles;
create policy "Users read own or admin reads all profiles"
    on public.profiles for select to authenticated
    using (id = auth.uid() or public.dashboard_is_admin());

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles"
    on public.profiles for update to authenticated
    using (public.dashboard_is_admin())
    with check (public.dashboard_is_admin());

create table if not exists public.site_settings (
    id integer primary key check (id = 1),
    settings jsonb not null default '{}'::jsonb,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

insert into public.site_settings (id, settings)
values (
    1,
    jsonb_build_object(
        'centre', 'IP Center Mali',
        'email', 'kdrissa718@gmail.com',
        'telephone', '+223 92 48 87 30',
        'validation', true,
        'publication', true
    )
)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;
grant select, insert, update on public.site_settings to authenticated;

drop policy if exists "Admins manage site settings" on public.site_settings;
create policy "Admins manage site settings"
    on public.site_settings for all to authenticated
    using (public.dashboard_is_admin())
    with check (public.dashboard_is_admin());

create table if not exists public.cours (
    id uuid primary key default gen_random_uuid(),
    formation_id text,
    categorie text not null default '',
    professor_id uuid references auth.users(id) on delete set null,
    title text not null,
    description text not null default '',
    teacher text not null default '',
    teacher_email text not null default '',
    price numeric not null default 0,
    thumbnail_url text,
    youtube_url text,
    video_url text,
    pdf_url text,
    exercises jsonb not null default '[]'::jsonb,
    status text not null default 'Publié',
    created_at timestamptz not null default now()
);

alter table public.cours add column if not exists teacher text not null default '';
alter table public.cours add column if not exists teacher_email text not null default '';
alter table public.cours add column if not exists formation_id text;
alter table public.cours add column if not exists categorie text not null default '';
alter table public.cours add column if not exists professor_id uuid references auth.users(id) on delete set null;
alter table public.cours add column if not exists price numeric not null default 0;
alter table public.cours add column if not exists thumbnail_url text;
alter table public.cours add column if not exists youtube_url text;
alter table public.cours add column if not exists video_url text;
alter table public.cours add column if not exists pdf_url text;
alter table public.cours add column if not exists exercises jsonb not null default '[]'::jsonb;
alter table public.cours add column if not exists status text not null default 'Publié';
alter table public.cours add column if not exists is_open boolean not null default true;
alter table public.cours add column if not exists created_at timestamptz not null default now();

alter table public.cours enable row level security;
grant select, insert, update, delete on public.cours to authenticated;

drop policy if exists "Active users read published or owned courses" on public.cours;
create policy "Active users read published or owned courses"
    on public.cours for select to authenticated
    using (
        public.dashboard_is_admin()
        or (
            public.dashboard_user_is_active()
            and (status = 'Publié' or professor_id = auth.uid())
        )
    );

drop policy if exists "Teachers and admins create courses" on public.cours;
create policy "Teachers and admins create courses"
    on public.cours for insert to authenticated
    with check (
        public.dashboard_is_admin()
        or (
            public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
            and professor_id = auth.uid()
        )
    );

drop policy if exists "Teachers and admins update courses" on public.cours;
create policy "Teachers and admins update courses"
    on public.cours for update to authenticated
    using (
        public.dashboard_is_admin()
        or (
            public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
            and professor_id = auth.uid()
        )
    )
    with check (
        public.dashboard_is_admin()
        or (
            public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
            and professor_id = auth.uid()
        )
    );

drop policy if exists "Teachers and admins delete courses" on public.cours;
create policy "Teachers and admins delete courses"
    on public.cours for delete to authenticated
    using (
        public.dashboard_is_admin()
        or (
            public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
            and professor_id = auth.uid()
        )
    );

create table if not exists public.student_course_access (
    student_id uuid not null references auth.users(id) on delete cascade,
    course_id text not null,
    created_at timestamptz not null default now(),
    primary key (student_id, course_id)
);

alter table public.student_course_access enable row level security;
grant select, insert, update, delete on public.student_course_access to authenticated;

drop policy if exists "Students manage own course access" on public.student_course_access;
create policy "Students manage own course access"
    on public.student_course_access for all to authenticated
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
            select 1 from public.cours course
            where course.id::text = course_id
              and course.status = 'Publié'
              and course.is_open
        )
    );

drop policy if exists "Admins read course access" on public.student_course_access;
create policy "Admins read course access"
    on public.student_course_access for select to authenticated
    using (public.dashboard_is_admin());

create table if not exists public.student_formation_access (
    student_id uuid not null references auth.users(id) on delete cascade,
    formation_id text not null,
    created_at timestamptz not null default now(),
    primary key (student_id, formation_id)
);

alter table public.student_formation_access enable row level security;
grant select, insert, update, delete on public.student_formation_access to authenticated;

drop policy if exists "Students manage own formation access" on public.student_formation_access;
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
    );

drop policy if exists "Admins read formation access" on public.student_formation_access;
create policy "Admins read formation access"
    on public.student_formation_access for select to authenticated
    using (public.dashboard_is_admin());

create table if not exists public.student_questions (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    teacher_id uuid references auth.users(id) on delete set null,
    course_id text,
    course_title text not null,
    question text not null,
    status text not null default 'Envoyée',
    response text,
    created_at timestamptz not null default now(),
    responded_at timestamptz
);

alter table public.student_questions enable row level security;
grant select, insert, update on public.student_questions to authenticated;
revoke update on public.student_questions from authenticated;
revoke insert on public.student_questions from authenticated;
grant insert (student_id, teacher_id, course_id, course_title, question)
    on public.student_questions to authenticated;
grant update (response, status, responded_at)
    on public.student_questions to authenticated;

drop policy if exists "Students read own questions" on public.student_questions;
create policy "Students read own questions"
    on public.student_questions for select to authenticated
    using (student_id = auth.uid() or public.dashboard_is_admin());

drop policy if exists "Teachers read assigned questions" on public.student_questions;
create policy "Teachers read assigned questions"
    on public.student_questions for select to authenticated
    using (
        teacher_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'teacher'
    );

drop policy if exists "Students create own questions" on public.student_questions;
create policy "Students create own questions"
    on public.student_questions for insert to authenticated
    with check (
        student_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'student'
        and (
            (course_id is null and teacher_id is null)
            or (teacher_id is null and course_id like 'formation-%')
            or exists (
                select 1
                from public.cours c
                where c.id::text = course_id
                  and c.professor_id is not distinct from teacher_id
                  and c.status = 'Publié'
                  and c.is_open
            )
        )
    );

drop policy if exists "Teachers answer assigned questions" on public.student_questions;
create policy "Teachers answer assigned questions"
    on public.student_questions for update to authenticated
    using (
        public.dashboard_is_admin()
        or (
            teacher_id = auth.uid()
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
        )
    )
    with check (
        public.dashboard_is_admin()
        or (
            teacher_id = auth.uid()
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
        )
    );

create table if not exists public.exercise_submissions (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    student_email text not null default '',
    student_name text not null default '',
    teacher_id uuid references auth.users(id) on delete set null,
    course_id text not null,
    course_title text not null,
    exercise_id text not null,
    exercise_text text not null default '',
    answer text not null,
    status text not null default 'pending'
        check (status in ('pending', 'graded')),
    grade numeric,
    max_score numeric not null default 20,
    feedback text,
    submitted_at timestamptz not null default now(),
    graded_at timestamptz,
    grader_id uuid references auth.users(id) on delete set null,
    unique (student_id, course_id, exercise_id)
);

alter table public.exercise_submissions enable row level security;
grant select on public.exercise_submissions to authenticated;
revoke insert, update on public.exercise_submissions from authenticated;
grant update (grade, feedback, status, graded_at, grader_id)
    on public.exercise_submissions to authenticated;

drop policy if exists "Students and teachers read submissions" on public.exercise_submissions;
create policy "Students and teachers read submissions"
    on public.exercise_submissions for select to authenticated
    using (
        public.dashboard_is_admin()
        or (
            student_id = auth.uid()
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'student'
        )
        or (
            teacher_id = auth.uid()
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
        )
    );

drop policy if exists "Students submit own exercises" on public.exercise_submissions;

drop policy if exists "Students and teachers update submissions" on public.exercise_submissions;
drop policy if exists "Teachers and admins update submissions" on public.exercise_submissions;
create policy "Teachers and admins update submissions"
    on public.exercise_submissions for update to authenticated
    using (
        public.dashboard_is_admin()
        or (
            teacher_id = auth.uid()
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
        )
    )
    with check (
        public.dashboard_is_admin()
        or (
            teacher_id = auth.uid()
            and grader_id = auth.uid()
            and status = 'graded'
            and public.dashboard_user_is_active()
            and public.dashboard_user_role() = 'teacher'
        )
    );

create or replace function public.submit_exercise_answer(
    p_course_id text,
    p_exercise_id text,
    p_answer text
)
returns public.exercise_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_student uuid := auth.uid();
    student_profile public.profiles%rowtype;
    student_email text;
    course_record public.cours%rowtype;
    exercise_record jsonb;
    maximum_score numeric;
    saved_submission public.exercise_submissions%rowtype;
begin
    if current_student is null or length(trim(coalesce(p_answer, ''))) = 0 then
        raise exception 'Session ou réponse invalide.';
    end if;

    select *
    into student_profile
    from public.profiles
    where id = current_student
      and role = 'student'
      and status = 'Actif';

    if not found then
        raise exception 'Compte étudiant inactif ou invalide.';
    end if;

    select *
    into course_record
    from public.cours c
    where c.id::text = p_course_id
      and c.status = 'Publié';

    if not found then
        raise exception 'Cours introuvable ou non publié.';
    end if;

    if not exists (
        select 1
        from public.profiles teacher_profile
        where teacher_profile.id = course_record.professor_id
          and teacher_profile.role = 'teacher'
          and teacher_profile.status = 'Actif'
    ) then
        raise exception 'Professeur du cours inactif ou invalide.';
    end if;

    if not exists (
        select 1
        from public.student_course_access access
        where access.student_id = current_student
          and access.course_id = p_course_id
    ) then
        raise exception 'Accès au cours non autorisé.';
    end if;

    select exercise.value
    into exercise_record
    from jsonb_array_elements(
        case
            when jsonb_typeof(course_record.exercises) = 'array'
                then course_record.exercises
            else '[]'::jsonb
        end
    ) as exercise(value)
    where coalesce(exercise.value ->> 'id', 'final') = p_exercise_id
    limit 1;

    if not found then
        raise exception 'Exercice introuvable.';
    end if;

    maximum_score := coalesce((exercise_record ->> 'maxScore')::numeric, 20);
    select coalesce(u.email, '')
    into student_email
    from auth.users u
    where u.id = current_student;

    insert into public.exercise_submissions as existing_submission (
        student_id,
        student_email,
        student_name,
        teacher_id,
        course_id,
        course_title,
        exercise_id,
        exercise_text,
        answer,
        max_score
    )
    values (
        current_student,
        student_email,
        student_profile.full_name,
        course_record.professor_id,
        p_course_id,
        course_record.title,
        p_exercise_id,
        coalesce(exercise_record ->> 'text', ''),
        trim(p_answer),
        maximum_score
    )
    on conflict (student_id, course_id, exercise_id)
    do update
        set answer = excluded.answer,
            submitted_at = now()
        where existing_submission.status = 'pending'
    returning * into saved_submission;

    if not found then
        raise exception 'Cet exercice a déjà été corrigé.';
    end if;

    return saved_submission;
end;
$$;

revoke all on function public.submit_exercise_answer(text, text, text) from public;
grant execute on function public.submit_exercise_answer(text, text, text) to authenticated;

create table if not exists public.student_certificates (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    course_id text not null,
    course_title text not null,
    student_name text not null,
    filename text not null,
    created_at timestamptz not null default now(),
    unique (student_id, course_id)
);

alter table public.student_certificates enable row level security;
grant select, insert on public.student_certificates to authenticated;

drop policy if exists "Students read own certificates" on public.student_certificates;
create policy "Students read own certificates"
    on public.student_certificates for select to authenticated
    using (student_id = auth.uid() or public.dashboard_is_admin());

drop policy if exists "Students create own certificates" on public.student_certificates;
create policy "Students create own certificates"
    on public.student_certificates for insert to authenticated
    with check (
        student_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'student'
        and exists (
            select 1
            from public.cours c
            where c.id::text = course_id
              and c.title = course_title
              and jsonb_typeof(c.exercises) = 'array'
              and jsonb_array_length(c.exercises) > 0
              and not exists (
                  select 1
                  from jsonb_array_elements(
                      case
                          when jsonb_typeof(c.exercises) = 'array' then c.exercises
                          else '[]'::jsonb
                      end
                  ) as exercise(value)
                  where not exists (
                      select 1
                      from public.exercise_submissions submission
                      where submission.student_id = auth.uid()
                        and submission.course_id = c.id::text
                        and submission.exercise_id =
                            coalesce(exercise.value ->> 'id', 'final')
                        and submission.status = 'graded'
                        and submission.grade >= 10
                  )
              )
        )
    );

create table if not exists public.contact_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null,
    sender text not null default 'visitor'
        check (sender in ('visitor', 'admin')),
    message_type text not null
        check (message_type in ('text', 'audio', 'contact')),
    content text not null
        check (length(content) between 1 and 7000000),
    sender_name text,
    sender_email text,
    sender_phone text,
    subject text,
    content_preview text generated always as (
        case
            when message_type = 'audio' then 'Un message audio a été reçu.'
            else left(content, 1000)
        end
    ) stored,
    status text not null default 'Nouveau',
    created_at timestamptz not null default now()
);

alter table public.contact_messages
    add column if not exists sender_phone text;

alter table public.contact_messages enable row level security;
revoke insert, update, delete on public.contact_messages from anon, authenticated;
grant insert (
    conversation_id,
    sender,
    message_type,
    content,
    sender_name,
    sender_email,
    sender_phone,
    subject
) on public.contact_messages to anon, authenticated;
grant select on public.contact_messages to authenticated;
grant delete on public.contact_messages to authenticated;

drop policy if exists "Visitors send contact messages" on public.contact_messages;
create policy "Visitors send contact messages"
    on public.contact_messages for insert to anon, authenticated
    with check (
        sender = 'visitor'
        and length(content) between 1 and 7000000
    );

drop policy if exists "Admins read contact messages" on public.contact_messages;
create policy "Admins read contact messages"
    on public.contact_messages for select to authenticated
    using (public.dashboard_is_admin());

drop policy if exists "Admins delete contact messages" on public.contact_messages;
create policy "Admins delete contact messages"
    on public.contact_messages for delete to authenticated
    using (public.dashboard_is_admin());

insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can read course files" on storage.objects;
create policy "Public can read course files"
    on storage.objects for select to public
    using (bucket_id = 'course-files');

drop policy if exists "Teachers upload own course files" on storage.objects;
create policy "Teachers upload own course files"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'course-files'
        and (storage.foldername(name))[1] = auth.uid()::text
        and public.dashboard_user_role() = 'teacher'
        and public.dashboard_user_is_active()
    );

drop policy if exists "Teachers update own course files" on storage.objects;
create policy "Teachers update own course files"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'course-files'
        and (
            (
                (storage.foldername(name))[1] = auth.uid()::text
                and public.dashboard_user_role() = 'teacher'
                and public.dashboard_user_is_active()
            )
            or public.dashboard_is_admin()
        )
    )
    with check (
        bucket_id = 'course-files'
        and (
            (
                (storage.foldername(name))[1] = auth.uid()::text
                and public.dashboard_user_role() = 'teacher'
                and public.dashboard_user_is_active()
            )
            or public.dashboard_is_admin()
        )
    );

drop policy if exists "Teachers delete own course files" on storage.objects;
create policy "Teachers delete own course files"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'course-files'
        and (
            (
                (storage.foldername(name))[1] = auth.uid()::text
                and public.dashboard_user_role() = 'teacher'
                and public.dashboard_user_is_active()
            )
            or public.dashboard_is_admin()
        )
    );
