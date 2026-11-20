-- Contact form and visitor support chat.
-- Run after dashboard-data.sql because the admin role helpers are defined there.

create extension if not exists pgcrypto;

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

create index if not exists contact_messages_created_at_idx
    on public.contact_messages (created_at desc);
create index if not exists contact_messages_conversation_idx
    on public.contact_messages (conversation_id, created_at);

alter table public.contact_messages enable row level security;

-- Visitors can submit messages, but cannot read or modify stored messages.
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
