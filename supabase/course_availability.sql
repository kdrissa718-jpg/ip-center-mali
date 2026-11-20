-- Run after dashboard-data.sql, formation_inscriptions.sql and formation_learning.sql.
-- Closed content stays visible in the catalog but cannot be enrolled in or opened.
alter table public.cours
    add column if not exists is_open boolean not null default true;
alter table public.formations
    add column if not exists is_open boolean not null default true;

create or replace function public.admin_set_course_open(
    p_course_id text,
    p_is_open boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.dashboard_user_is_active() or not public.dashboard_is_admin() then
        raise exception 'Seul un administrateur actif peut ouvrir ou fermer un cours.';
    end if;
    if p_is_open is null then
        raise exception 'Indiquez si le cours est ouvert ou fermé.';
    end if;

    update public.cours
       set is_open = p_is_open
     where id::text = p_course_id;
    if not found then
        raise exception 'Cours introuvable.';
    end if;
end;
$$;

create or replace function public.admin_set_formation_open(
    p_formation_id text,
    p_is_open boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.dashboard_user_is_active() or not public.dashboard_is_admin() then
        raise exception 'Seul un administrateur actif peut ouvrir ou fermer une formation.';
    end if;
    if p_is_open is null then
        raise exception 'Indiquez si la formation est ouverte ou fermée.';
    end if;

    update public.formations
       set is_open = p_is_open
     where id::text = p_formation_id;
    if not found then
        raise exception 'Formation introuvable.';
    end if;
end;
$$;

revoke all on function public.admin_set_course_open(text, boolean) from public, anon;
revoke all on function public.admin_set_formation_open(text, boolean) from public, anon;
grant execute on function public.admin_set_course_open(text, boolean) to authenticated;
grant execute on function public.admin_set_formation_open(text, boolean) to authenticated;

create or replace function public.get_formation_playlist(p_formation_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target_formation public.formations%rowtype;
    v_current_role text := public.dashboard_user_role();
    course_items jsonb;
    lesson_items jsonb;
begin
    if auth.uid() is null or not public.dashboard_user_is_active()
       or v_current_role not in ('admin', 'teacher', 'student') then
        raise exception 'Connectez-vous avec un compte actif pour afficher cette playlist.';
    end if;

    select formation.* into target_formation
    from public.formations formation
    where formation.id::text = p_formation_id;
    if not found then
        raise exception 'Formation introuvable.';
    end if;
    if v_current_role = 'teacher'
       and not public.teacher_can_manage_formation(p_formation_id) then
        raise exception 'Cette playlist ne fait pas partie de vos formations.';
    end if;
    if v_current_role = 'student' and not target_formation.is_open then
        return jsonb_build_object('is_open', false, 'courses', '[]'::jsonb, 'lessons', '[]'::jsonb);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', course.id,
        'title', course.title,
        'teacher', course.teacher,
        'is_open', course.is_open,
        'video_url', case when course.is_open then course.video_url else null end,
        'youtube_url', case when course.is_open then course.youtube_url else null end,
        'pdf_url', case when course.is_open then course.pdf_url else null end
    ) order by course.created_at, course.title), '[]'::jsonb)
      into course_items
      from public.cours course
     where course.formation_id::text = p_formation_id
       and course.status = 'Publié';

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', lesson.id,
        'title', lesson.title,
        'video_url', lesson.video_url,
        'position', lesson.position
    ) order by lesson.position), '[]'::jsonb)
      into lesson_items
      from public.formation_lessons lesson
     where lesson.formation_id = p_formation_id;

    return jsonb_build_object(
        'is_open', target_formation.is_open,
        'courses', course_items,
        'lessons', lesson_items
    );
end;
$$;

revoke all on function public.get_formation_playlist(text) from public, anon;
grant execute on function public.get_formation_playlist(text) to authenticated;

create or replace function public.prevent_non_admin_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.is_open is distinct from old.is_open
       and (not public.dashboard_user_is_active() or not public.dashboard_is_admin()) then
        raise exception 'Seul un administrateur actif peut modifier l’accès étudiant.';
    end if;
    return new;
end;
$$;

drop trigger if exists protect_course_availability on public.cours;
create trigger protect_course_availability
before update of is_open on public.cours
for each row execute function public.prevent_non_admin_availability_change();

drop trigger if exists protect_formation_availability on public.formations;
create trigger protect_formation_availability
before update of is_open on public.formations
for each row execute function public.prevent_non_admin_availability_change();

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
        and exists (
            select 1 from public.formations formation
            where formation.id::text = formation_id
              and formation.is_open
        )
    );

create or replace function public.student_has_formation_access(p_formation_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.dashboard_user_is_active()
       and public.dashboard_user_role() = 'student'
       and exists (
           select 1
           from public.student_formation_access access
           join public.formations formation
             on formation.id::text = access.formation_id
           where access.student_id = auth.uid()
             and access.formation_id = p_formation_id
             and formation.is_open
       );
$$;

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
                from public.cours course
                where course.id::text = course_id
                  and course.professor_id is not distinct from teacher_id
                  and course.status = 'Publié'
                  and course.is_open
            )
        )
    );

create or replace function public.prevent_closed_course_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1 from public.cours course
        where course.id::text = new.course_id
          and (course.status <> 'Publié' or not course.is_open)
    ) then
        raise exception 'Ce cours est fermé. Les exercices ne peuvent plus être envoyés.';
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_closed_course_submission on public.exercise_submissions;
create trigger prevent_closed_course_submission
before insert or update on public.exercise_submissions
for each row execute function public.prevent_closed_course_submission();

create or replace function public.prevent_closed_formation_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if public.dashboard_user_role() = 'student'
       and exists (
           select 1
           from public.formation_lessons lesson
           join public.formations formation
             on formation.id::text = lesson.formation_id
           where lesson.id = new.lesson_id
             and not formation.is_open
       ) then
        raise exception 'Cette formation est fermée. Les étapes ne sont plus accessibles.';
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_closed_formation_progress on public.formation_lesson_progress;
create trigger prevent_closed_formation_progress
before insert or update on public.formation_lesson_progress
for each row execute function public.prevent_closed_formation_progress();
