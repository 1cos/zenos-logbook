-- Zeno's Logbook (B-60) — isolated tables in the Brigade project. Touches nothing that exists.
-- Access ONLY through the edge function zenos-logbook-api (service role). RLS on, no policies, no grants to anon/authenticated.
-- ROLLBACK:
--   drop table if exists public.logbook_comments, public.logbook_entries, public.logbook_topics,
--     public.logbook_sessions, public.logbook_login_fails, public.logbook_people cascade;
--   delete from storage.objects where bucket_id='logbook-photos'; delete from storage.buckets where id='logbook-photos';

create table public.logbook_people(
  id serial primary key,
  name text not null unique,
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.logbook_sessions(
  id uuid primary key default gen_random_uuid(),
  person_id int not null references public.logbook_people(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table public.logbook_login_fails(
  id bigserial primary key,
  person_id int references public.logbook_people(id),
  ip_hash text,
  at timestamptz not null default now()
);
create table public.logbook_topics(
  id text primary key,
  name text not null check (length(name) between 1 and 40),
  hint text,
  has_amount boolean not null default false,
  sort int not null default 100,
  created_by int references public.logbook_people(id),
  created_at timestamptz not null default now()
);
create table public.logbook_entries(
  id uuid primary key default gen_random_uuid(),
  topic_id text not null references public.logbook_topics(id),
  person_id int not null references public.logbook_people(id),
  body text not null check (length(body) between 1 and 4000),
  amount numeric(10,2) check (amount is null or amount >= 0),
  photo_path text,
  created_at timestamptz not null default now()
);
create table public.logbook_comments(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.logbook_entries(id),
  person_id int not null references public.logbook_people(id),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.logbook_entries(topic_id, created_at desc);
create index on public.logbook_comments(entry_id, created_at);
create index on public.logbook_login_fails(person_id, at);

do $$ declare t text; begin
  foreach t in array array['logbook_people','logbook_sessions','logbook_login_fails','logbook_topics','logbook_entries','logbook_comments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.logbook_people_id_seq, public.logbook_login_fails_id_seq from anon, authenticated;

insert into public.logbook_topics(id,name,hint,has_amount,sort) values
 ('daily','Daily log','How the day went: covers, weather, events, anything worth remembering',false,10),
 ('purchases','Purchases','Things bought outside the usual orders',true,20),
 ('maintenance','Maintenance','Repairs, technicians, scheduled service',false,30),
 ('breakage','Breakage','Broken plates, glasses, equipment',true,40),
 ('service','Service','Guests, waits, comps, compliments, complaints',false,50),
 ('staff','Staff','Call-outs, late arrivals, schedule changes',false,60);
insert into public.logbook_people(name) values ('Max'),('Monica'),('Mike'),('Zeno'),('Beau');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('logbook-photos','logbook-photos',false,3145728,array['image/jpeg']);

-- PIN check (bcrypt via pgcrypto), callable only by the service role. PINs are set by hand (initial PINs in ~/.brigade_secrets, never in git/email).
create or replace function public.logbook_check_pin(p_name text, p_pin text) returns int
language sql security definer set search_path = '' as $$
  select id from public.logbook_people where name = p_name and active and pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash)
$$;
revoke all on function public.logbook_check_pin(text,text) from public, anon, authenticated;
grant execute on function public.logbook_check_pin(text,text) to service_role;
-- ROLLBACK also: drop function if exists public.logbook_check_pin(text,text);
