-- Run dashboard-data.sql and formation_inscriptions.sql first.
create table if not exists public.formation_lessons (
    id uuid primary key default gen_random_uuid(),
    formation_id text not null,
    title text not null check (length(btrim(title)) > 0),
    content text not null check (length(btrim(content)) > 0),
    video_url text,
    position integer not null check (position > 0),
    created_at timestamptz not null default now(),
    unique (formation_id, position)
);

create table if not exists public.formation_lesson_questions (
    id uuid primary key default gen_random_uuid(),
    lesson_id uuid not null references public.formation_lessons(id) on delete cascade,
    prompt text not null check (length(btrim(prompt)) > 0),
    question_type text not null
        check (question_type in ('single_choice', 'multiple_choice', 'text')),
    options jsonb not null default '[]'::jsonb
        check (jsonb_typeof(options) = 'array'),
    position integer not null check (position > 0),
    created_at timestamptz not null default now(),
    unique (lesson_id, position)
);

create table if not exists public.formation_lesson_question_answers (
    question_id uuid primary key
        references public.formation_lesson_questions(id) on delete cascade,
    correct_answer jsonb
);

create table if not exists public.formation_lesson_progress (
    student_id uuid not null references auth.users(id) on delete cascade,
    lesson_id uuid not null references public.formation_lessons(id) on delete cascade,
    answers jsonb not null check (jsonb_typeof(answers) = 'object'),
    score_correct integer not null default 0 check (score_correct >= 0),
    score_total integer not null default 0 check (score_total >= 0),
    submitted_at timestamptz not null default now(),
    primary key (student_id, lesson_id)
);

alter table public.formation_lesson_progress
    add column if not exists status text not null default 'submitted'
        check (status in ('submitted', 'pending_correction', 'passed', 'rejected'));
alter table public.formation_lesson_progress
    add column if not exists correction text;
alter table public.formation_lesson_progress
    add column if not exists graded_by uuid references auth.users(id);
alter table public.formation_lesson_progress
    add column if not exists graded_at timestamptz;

create index if not exists formation_lessons_order_idx
    on public.formation_lessons (formation_id, position);
create index if not exists formation_lesson_questions_order_idx
    on public.formation_lesson_questions (lesson_id, position);

alter table public.formation_lessons enable row level security;
alter table public.formation_lesson_questions enable row level security;
alter table public.formation_lesson_question_answers enable row level security;
alter table public.formation_lesson_progress enable row level security;

grant select on public.formation_lessons to authenticated;
grant select on public.formation_lesson_questions to authenticated;
grant select on public.formation_lesson_progress to authenticated;
revoke all on public.formation_lesson_question_answers from anon, authenticated;

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
           where access.student_id = auth.uid()
             and access.formation_id = p_formation_id
       );
$$;

create or replace function public.teacher_can_manage_formation(p_formation_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.dashboard_user_is_active()
       and public.dashboard_user_role() = 'teacher'
       and exists (
           select 1
           from public.cours course
           where course.formation_id::text = p_formation_id
             and course.professor_id = auth.uid()
       );
$$;

create or replace function public.student_can_read_formation_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.formation_lessons lesson
        where lesson.id = p_lesson_id
          and public.student_has_formation_access(lesson.formation_id)
          and exists (
              select 1
              from public.formation_lesson_questions question
              where question.lesson_id = lesson.id
          )
    );
$$;

drop policy if exists "Students read enrolled formation lessons"
    on public.formation_lessons;
create policy "Students read enrolled formation lessons"
    on public.formation_lessons for select to authenticated
    using (public.student_can_read_formation_lesson(id));

drop policy if exists "Admins manage formation lessons"
    on public.formation_lessons;
create policy "Admins manage formation lessons"
    on public.formation_lessons for all to authenticated
    using (public.dashboard_is_admin())
    with check (public.dashboard_is_admin());

drop policy if exists "Teachers manage formation lessons"
    on public.formation_lessons;
create policy "Teachers manage formation lessons"
    on public.formation_lessons for all to authenticated
    using (public.teacher_can_manage_formation(formation_id))
    with check (public.teacher_can_manage_formation(formation_id));

drop policy if exists "Students read enrolled lesson questions"
    on public.formation_lesson_questions;
create policy "Students read enrolled lesson questions"
    on public.formation_lesson_questions for select to authenticated
    using (public.student_can_read_formation_lesson(lesson_id));

drop policy if exists "Admins manage formation lesson questions"
    on public.formation_lesson_questions;
create policy "Admins manage formation lesson questions"
    on public.formation_lesson_questions for all to authenticated
    using (public.dashboard_is_admin())
    with check (public.dashboard_is_admin());

drop policy if exists "Teachers manage formation lesson questions"
    on public.formation_lesson_questions;
create policy "Teachers manage formation lesson questions"
    on public.formation_lesson_questions for all to authenticated
    using (
        exists (
            select 1
            from public.formation_lessons lesson
            where lesson.id = lesson_id
              and public.teacher_can_manage_formation(lesson.formation_id)
        )
    )
    with check (
        exists (
            select 1
            from public.formation_lessons lesson
            where lesson.id = lesson_id
              and public.teacher_can_manage_formation(lesson.formation_id)
        )
    );

drop policy if exists "Students read own formation lesson progress"
    on public.formation_lesson_progress;
create policy "Students read own formation lesson progress"
    on public.formation_lesson_progress for select to authenticated
    using (
        student_id = auth.uid()
        and public.dashboard_user_is_active()
        and public.dashboard_user_role() = 'student'
    );

drop policy if exists "Admins read formation lesson progress"
    on public.formation_lesson_progress;
create policy "Admins read formation lesson progress"
    on public.formation_lesson_progress for select to authenticated
    using (public.dashboard_is_admin());

drop policy if exists "Teachers read formation lesson progress"
    on public.formation_lesson_progress;
create policy "Teachers read formation lesson progress"
    on public.formation_lesson_progress for select to authenticated
    using (
        exists (
            select 1
            from public.formation_lessons lesson
            where lesson.id = lesson_id
              and public.teacher_can_manage_formation(lesson.formation_id)
        )
    );

create or replace function public.admin_save_formation_lesson(
    p_formation_id text,
    p_title text,
    p_content text,
    p_video_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_lesson_id uuid;
    next_position integer;
begin
    if not public.dashboard_user_is_active()
       or public.dashboard_user_role() not in ('admin', 'teacher') then
        raise exception 'Accès réservé à un professeur ou administrateur actif.';
    end if;
    if nullif(btrim(p_formation_id), '') is null
       or nullif(btrim(p_title), '') is null
       or nullif(btrim(p_content), '') is null then
        raise exception 'La formation, le titre et le contenu sont obligatoires.';
    end if;
    if p_video_url is not null and btrim(p_video_url) <> ''
       and p_video_url !~* '^https?://' then
        raise exception 'Le lien vidéo doit commencer par http:// ou https://.';
    end if;
    if not exists (
        select 1 from public.formations formation
        where formation.id::text = p_formation_id
    ) then
        raise exception 'Formation introuvable.';
    end if;
    if public.dashboard_user_role() = 'teacher'
       and not public.teacher_can_manage_formation(p_formation_id) then
        raise exception 'Vous ne pouvez organiser que les formations de vos cours.';
    end if;

    select coalesce(max(lesson.position), 0) + 1
      into next_position
      from public.formation_lessons lesson
     where lesson.formation_id = p_formation_id;

    insert into public.formation_lessons (
        formation_id, title, content, video_url, position
    )
    values (
        p_formation_id,
        btrim(p_title),
        btrim(p_content),
        nullif(btrim(p_video_url), ''),
        next_position
    )
    returning id into new_lesson_id;

    return new_lesson_id;
end;
$$;

create or replace function public.admin_save_formation_question(
    p_lesson_id uuid,
    p_prompt text,
    p_question_type text,
    p_options jsonb,
    p_correct_answer jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_question_id uuid;
    next_position integer;
    option_count integer;
    answer_count integer;
begin
    if not public.dashboard_user_is_active()
       or public.dashboard_user_role() not in ('admin', 'teacher') then
        raise exception 'Accès réservé à un professeur ou administrateur actif.';
    end if;
    if nullif(btrim(p_prompt), '') is null then
        raise exception 'La question est obligatoire.';
    end if;
    if p_question_type not in ('single_choice', 'multiple_choice', 'text') then
        raise exception 'Type de question non pris en charge.';
    end if;

    if p_question_type in ('single_choice', 'multiple_choice') then
        if jsonb_typeof(p_options) <> 'array' then
            raise exception 'Les choix doivent être une liste.';
        end if;
        select count(*) into option_count
        from jsonb_array_elements_text(p_options) as option_item(value);
        if option_count < 2 or p_correct_answer is null then
            raise exception 'Ajoutez au moins deux choix et désignez la ou les réponses correctes.';
        end if;
        if p_question_type = 'single_choice' then
            if jsonb_typeof(p_correct_answer) <> 'string'
               or not (p_options @> jsonb_build_array(p_correct_answer #>> '{}')) then
                raise exception 'La bonne réponse doit faire partie des choix.';
            end if;
        else
            if jsonb_typeof(p_correct_answer) <> 'array' then
                raise exception 'Les bonnes réponses doivent être une liste de choix.';
            end if;
            select count(*) into answer_count
            from jsonb_array_elements_text(p_correct_answer) as answer_item(value);
            if answer_count < 1 or exists (
                select 1
                from jsonb_array_elements_text(p_correct_answer) as answer_item(value)
                where not (p_options @> jsonb_build_array(value))
            ) then
                raise exception 'Chaque bonne réponse doit faire partie des choix.';
            end if;
        end if;
    elsif coalesce(p_options, '[]'::jsonb) <> '[]'::jsonb
       or (p_correct_answer is not null and p_correct_answer <> 'null'::jsonb) then
        raise exception 'Une question à réponse libre ne doit pas définir de choix ni de correction automatique.';
    end if;

    if not exists (
        select 1
        from public.formation_lessons lesson
        where lesson.id = p_lesson_id
    ) then
        raise exception 'Leçon introuvable.';
    end if;
    if public.dashboard_user_role() = 'teacher'
       and not exists (
           select 1 from public.formation_lessons lesson
           where lesson.id = p_lesson_id
             and public.teacher_can_manage_formation(lesson.formation_id)
       ) then
        raise exception 'Vous ne pouvez modifier que les formations de vos cours.';
    end if;

    select coalesce(max(question.position), 0) + 1
      into next_position
      from public.formation_lesson_questions question
     where question.lesson_id = p_lesson_id;

    insert into public.formation_lesson_questions (
        lesson_id, prompt, question_type, options, position
    )
    values (
        p_lesson_id,
        btrim(p_prompt),
        p_question_type,
        coalesce(p_options, '[]'::jsonb),
        next_position
    )
    returning id into new_question_id;

    insert into public.formation_lesson_question_answers (question_id, correct_answer)
    values (new_question_id, p_correct_answer);
    delete from public.formation_lesson_progress
    where lesson_id = p_lesson_id;

    return new_question_id;
end;
$$;

create or replace function public.admin_delete_formation_lesson(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.dashboard_user_is_active()
       or public.dashboard_user_role() not in ('admin', 'teacher') then
        raise exception 'Accès réservé à un professeur ou administrateur actif.';
    end if;
    if public.dashboard_user_role() = 'teacher'
       and not exists (
           select 1 from public.formation_lessons lesson
           where lesson.id = p_lesson_id
             and public.teacher_can_manage_formation(lesson.formation_id)
       ) then
        raise exception 'Vous ne pouvez supprimer que les leçons de vos formations.';
    end if;
    delete from public.formation_lessons where id = p_lesson_id;
    if not found then
        raise exception 'Leçon introuvable.';
    end if;
end;
$$;

create or replace function public.admin_delete_formation_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    affected_lesson_id uuid;
begin
    if not public.dashboard_user_is_active()
       or public.dashboard_user_role() not in ('admin', 'teacher') then
        raise exception 'Accès réservé à un professeur ou administrateur actif.';
    end if;
    select lesson_id into affected_lesson_id
    from public.formation_lesson_questions
    where id = p_question_id;
    if affected_lesson_id is null then
        raise exception 'Question introuvable.';
    end if;
    if public.dashboard_user_role() = 'teacher'
       and not exists (
           select 1 from public.formation_lessons lesson
           where lesson.id = affected_lesson_id
             and public.teacher_can_manage_formation(lesson.formation_id)
       ) then
        raise exception 'Vous ne pouvez supprimer que les questions de vos formations.';
    end if;

    delete from public.formation_lesson_questions where id = p_question_id;
    delete from public.formation_lesson_progress
    where lesson_id = affected_lesson_id;
end;
$$;

create or replace function public.submit_formation_lesson(
    p_lesson_id uuid,
    p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_student_id uuid := auth.uid();
    target_lesson public.formation_lessons%rowtype;
    question_row record;
    submitted_answer jsonb;
    submitted_values text[];
    expected_values text[];
    expected_question_count integer;
    received_answer_count integer;
    text_question_count integer := 0;
    correct_count integer := 0;
    graded_count integer := 0;
    final_status text;
begin
    if current_student_id is null
       or not public.dashboard_user_is_active()
       or public.dashboard_user_role() <> 'student' then
        raise exception 'Connexion requise avec un compte étudiant actif.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(current_student_id::text, 0));
    if jsonb_typeof(p_answers) <> 'object' then
        raise exception 'Les réponses envoyées ne sont pas valides.';
    end if;

    select lesson.* into target_lesson
    from public.formation_lessons lesson
    join public.student_formation_access access
      on access.formation_id = lesson.formation_id
     and access.student_id = current_student_id
    where lesson.id = p_lesson_id
      and exists (
          select 1 from public.formation_lesson_questions question
          where question.lesson_id = lesson.id
      );
    if not found then
        raise exception 'Leçon inaccessible ou sans exercice.';
    end if;

    if exists (
        select 1
        from public.formation_lessons prior_lesson
        where prior_lesson.formation_id = target_lesson.formation_id
          and prior_lesson.position < target_lesson.position
          and exists (
              select 1
              from public.formation_lesson_questions prior_question
              where prior_question.lesson_id = prior_lesson.id
          )
          and not exists (
              select 1
              from public.formation_lesson_progress progress
              where progress.student_id = current_student_id
                and progress.lesson_id = prior_lesson.id
                and progress.status = 'passed'
          )
    ) then
        raise exception 'Répondez aux exercices de la leçon précédente avant de continuer.';
    end if;

    select count(*) into expected_question_count
    from public.formation_lesson_questions question
    where question.lesson_id = target_lesson.id;
    select count(*) into received_answer_count
    from jsonb_object_keys(p_answers);
    if received_answer_count <> expected_question_count then
        raise exception 'Répondez à toutes les questions de cette leçon.';
    end if;

    for question_row in
        select question.id, question.question_type, question.options,
               answer.correct_answer
        from public.formation_lesson_questions question
        left join public.formation_lesson_question_answers answer
          on answer.question_id = question.id
        where question.lesson_id = target_lesson.id
        order by question.position
    loop
        submitted_answer := p_answers -> question_row.id::text;
        if submitted_answer is null then
            raise exception 'Répondez à toutes les questions de cette leçon.';
        end if;

        if question_row.question_type = 'text' then
            text_question_count := text_question_count + 1;
            if jsonb_typeof(submitted_answer) <> 'string'
               or nullif(btrim(submitted_answer #>> '{}'), '') is null then
                raise exception 'La réponse écrite ne peut pas être vide.';
            end if;
        elsif question_row.question_type = 'single_choice' then
            if jsonb_typeof(submitted_answer) <> 'string'
               or not (question_row.options @> jsonb_build_array(submitted_answer #>> '{}')) then
                raise exception 'Sélectionnez une réponse proposée pour chaque question.';
            end if;
            graded_count := graded_count + 1;
            if submitted_answer = question_row.correct_answer then
                correct_count := correct_count + 1;
            end if;
        elsif question_row.question_type = 'multiple_choice' then
            if jsonb_typeof(submitted_answer) <> 'array'
               or jsonb_array_length(submitted_answer) = 0 then
                raise exception 'Sélectionnez au moins une réponse pour chaque question.';
            end if;
            if exists (
                select 1
                from jsonb_array_elements_text(submitted_answer) as submitted_item(value)
                where not (question_row.options @> jsonb_build_array(value))
            ) then
                raise exception 'Sélectionnez uniquement les réponses proposées.';
            end if;
            select array_agg(value order by value)
              into submitted_values
              from jsonb_array_elements_text(submitted_answer) item(value);
            select array_agg(value order by value)
              into expected_values
              from jsonb_array_elements_text(question_row.correct_answer) item(value);
            graded_count := graded_count + 1;
            if submitted_values = expected_values then
                correct_count := correct_count + 1;
            end if;
        end if;
    end loop;

    if text_question_count > 0 then
        final_status := 'pending_correction';
    elsif graded_count > 0 and correct_count = graded_count then
        final_status := 'passed';
    elsif graded_count > 0 then
        final_status := 'rejected';
    else
        final_status := 'pending_correction';
    end if;

    insert into public.formation_lesson_progress (
        student_id, lesson_id, answers, score_correct, score_total,
        submitted_at, status, correction, graded_by, graded_at
    )
    values (
        current_student_id, target_lesson.id, p_answers,
        correct_count, graded_count, now(), final_status, null, null, null
    )
    on conflict (student_id, lesson_id) do update
        set answers = excluded.answers,
            score_correct = excluded.score_correct,
            score_total = excluded.score_total,
            submitted_at = excluded.submitted_at,
            status = excluded.status,
            correction = excluded.correction,
            graded_by = excluded.graded_by,
            graded_at = excluded.graded_at;

    return jsonb_build_object(
        'score_correct', correct_count,
        'score_total', graded_count,
        'status', final_status,
        'passed', final_status = 'passed',
        'submitted_at', now()
    );
end;
$$;

create or replace function public.grade_formation_lesson_progress(
    p_student_id uuid,
    p_lesson_id uuid,
    p_passed boolean,
    p_correction text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.dashboard_user_is_active()
       or public.dashboard_user_role() not in ('admin', 'teacher') then
        raise exception 'Accès réservé à un professeur ou administrateur actif.';
    end if;
    if p_passed is null then
        raise exception 'Indiquez si la réponse est validée ou à reprendre.';
    end if;
    if public.dashboard_user_role() = 'teacher'
       and not exists (
           select 1
           from public.formation_lessons lesson
           where lesson.id = p_lesson_id
             and public.teacher_can_manage_formation(lesson.formation_id)
       ) then
        raise exception 'Vous ne pouvez corriger que les formations de vos cours.';
    end if;

    update public.formation_lesson_progress progress
       set status = case when p_passed then 'passed' else 'rejected' end,
           correction = nullif(btrim(coalesce(p_correction, '')), ''),
           graded_by = auth.uid(),
           graded_at = now()
     where progress.student_id = p_student_id
       and progress.lesson_id = p_lesson_id;

    if not found then
        raise exception 'Aucune réponse étudiante trouvée pour cette leçon.';
    end if;
end;
$$;

revoke all on function public.admin_save_formation_lesson(text, text, text, text)
    from public, anon;
revoke all on function public.admin_save_formation_question(uuid, text, text, jsonb, jsonb)
    from public, anon;
revoke all on function public.admin_delete_formation_lesson(uuid) from public, anon;
revoke all on function public.admin_delete_formation_question(uuid) from public, anon;
revoke all on function public.submit_formation_lesson(uuid, jsonb) from public, anon;
revoke all on function public.grade_formation_lesson_progress(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.student_has_formation_access(text) from public, anon;
revoke all on function public.student_can_read_formation_lesson(uuid) from public, anon;
grant execute on function public.student_has_formation_access(text) to authenticated;
grant execute on function public.student_can_read_formation_lesson(uuid) to authenticated;
grant execute on function public.admin_save_formation_lesson(text, text, text, text)
    to authenticated;
grant execute on function public.admin_save_formation_question(uuid, text, text, jsonb, jsonb)
    to authenticated;
grant execute on function public.admin_delete_formation_lesson(uuid) to authenticated;
grant execute on function public.admin_delete_formation_question(uuid) to authenticated;
grant execute on function public.submit_formation_lesson(uuid, jsonb) to authenticated;
grant execute on function public.grade_formation_lesson_progress(uuid, uuid, boolean, text) to authenticated;
