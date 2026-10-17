-- Duora's first milestone: one private, two-person chat per user.
-- Run this migration in the Supabase SQL editor for your project.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.relationships (
  id uuid primary key default gen_random_uuid(),
  member_one uuid not null references auth.users(id) on delete cascade,
  member_two uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint relationships_distinct_members check (member_two is null or member_one <> member_two),
  constraint relationships_member_one_unique unique (member_one),
  constraint relationships_member_two_unique unique (member_two)
);

create table if not exists public.chat_invitations (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_relationship_created_idx
  on public.messages (relationship_id, created_at desc);

alter table public.relationships enable row level security;
alter table public.chat_invitations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Members can view their relationship" on public.relationships;
create policy "Members can view their relationship"
  on public.relationships for select to authenticated
  using (auth.uid() = member_one or auth.uid() = member_two);

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
  on public.messages for select to authenticated
  using (exists (
    select 1 from public.relationships r
    where r.id = relationship_id and auth.uid() in (r.member_one, r.member_two)
  ));

drop policy if exists "Members can send as themselves" on public.messages;
create policy "Members can send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.relationships r
      where r.id = relationship_id and auth.uid() in (r.member_one, r.member_two)
    )
  );

create or replace function public.create_chat_invitation()
returns table (relationship_id uuid, invite_code text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_relationship_id uuid;
  v_code text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  if exists (select 1 from public.relationships r where auth.uid() in (r.member_one, r.member_two)) then
    raise exception 'You already have a Duora chat.' using errcode = '23505';
  end if;
  v_code := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.relationships (member_one) values (auth.uid()) returning id into v_relationship_id;
  insert into public.chat_invitations (relationship_id, created_by, token_hash)
    values (v_relationship_id, auth.uid(), encode(extensions.digest(v_code, 'sha256'), 'hex'));
  return query select v_relationship_id, v_code;
end;
$$;

create or replace function public.accept_chat_invitation(invitation_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_relationship_id uuid;
  v_inviter uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  if invitation_code is null or length(invitation_code) <> 48 then
    raise exception 'This invite code is invalid or expired.' using errcode = '22023';
  end if;
  if exists (select 1 from public.relationships r where auth.uid() in (r.member_one, r.member_two)) then
    raise exception 'You already have a Duora chat.' using errcode = '23505';
  end if;
  select i.relationship_id, i.created_by into v_relationship_id, v_inviter
    from public.chat_invitations i
    where i.token_hash = encode(extensions.digest(invitation_code, 'sha256'), 'hex')
      and i.accepted_at is null and i.expires_at > now()
    for update;
  if v_relationship_id is null then
    raise exception 'This invite code is invalid, expired, or already used.' using errcode = '22023';
  end if;
  if v_inviter = auth.uid() then
    raise exception 'You cannot accept your own invite.' using errcode = '22023';
  end if;
  update public.relationships set member_two = auth.uid()
    where id = v_relationship_id and member_two is null;
  if not found then
    raise exception 'This chat already has two members.' using errcode = '23505';
  end if;
  update public.chat_invitations set accepted_at = now() where id = (
    select i.id from public.chat_invitations i where i.relationship_id = v_relationship_id
      and i.token_hash = encode(extensions.digest(invitation_code, 'sha256'), 'hex')
  );
  return v_relationship_id;
end;
$$;

revoke all on function public.create_chat_invitation() from public;
revoke all on function public.accept_chat_invitation(text) from public;
grant execute on function public.create_chat_invitation() to authenticated;
grant execute on function public.accept_chat_invitation(text) to authenticated;
grant select on public.relationships to authenticated;
grant select, insert on public.messages to authenticated;

-- Enable Realtime delivery for newly inserted messages.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
