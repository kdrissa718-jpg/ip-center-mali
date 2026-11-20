-- Run once to enable course categories on existing Supabase installations.
alter table public.cours
    add column if not exists categorie text not null default '';
