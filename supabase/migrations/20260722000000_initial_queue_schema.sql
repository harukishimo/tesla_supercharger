-- スパQ: Supabase Postgres initial schema
-- Business logic lives in Next.js server-side TypeScript.
-- This migration contains only persistence, integrity constraints, indexes, RLS,
-- and an updated_at trigger.

begin;

-- Supabase exposes pgcrypto by default. Keep the extension explicit so the
-- same migration can be verified against a plain local PostgreSQL database.
create extension if not exists pgcrypto;

create table public.charging_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  prefecture text,
  municipality text,
  normalized_search_text text not null,
  stall_count smallint not null check (stall_count between 1 and 128),
  default_charge_minutes smallint not null default 45 check (default_charge_minutes between 5 and 120),
  queue_enabled boolean not null default true,
  queue_version bigint not null default 0 check (queue_version >= 0),
  queue_started_at timestamptz,
  source_url text,
  source_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_slots (
  id uuid primary key default gen_random_uuid(),
  charging_site_id uuid not null references public.charging_sites(id) on delete restrict,
  slot_number smallint not null check (slot_number >= 1),
  status text not null default 'unknown' check (status in ('available', 'occupied', 'called', 'unknown')),
  active_entry_id uuid,
  estimated_available_at timestamptz,
  estimate_source text not null default 'system' check (estimate_source in ('default', 'user_input', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_slots_site_number_unique unique (charging_site_id, slot_number),
  constraint site_slots_id_site_unique unique (id, charging_site_id)
);

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  charging_site_id uuid not null references public.charging_sites(id) on delete restrict,
  queue_order bigint generated always as identity,
  management_token_hash bytea not null check (octet_length(management_token_hash) = 32),
  nickname text not null check (char_length(nickname) between 1 and 30),
  status text not null default 'waiting' check (status in ('waiting', 'notified', 'called', 'charging')),
  joined_at timestamptz not null default now(),
  estimated_start_at timestamptz,
  estimate_confidence text not null default 'unknown' check (estimate_confidence in ('confirmed', 'provisional', 'unknown')),
  assigned_slot_id uuid,
  called_at timestamptz,
  call_expires_at timestamptz,
  charging_started_at timestamptz,
  initial_charge_minutes smallint check (initial_charge_minutes between 5 and 120),
  duration_confirmed_at timestamptz,
  expected_finish_at timestamptz,
  finish_confirmation_expires_at timestamptz,
  push_opt_in boolean not null default false,
  push_subscription_id text,
  five_min_push_sent_at timestamptz,
  called_push_sent_at timestamptz,
  charge_end_push_sent_at timestamptz,
  join_idempotency_key_hash bytea,
  join_idempotency_fingerprint_hash bytea,
  last_mutation_key_hash bytea,
  last_mutation_fingerprint_hash bytea,
  last_mutation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint queue_entries_initial_duration_pair check (
    (initial_charge_minutes is null and duration_confirmed_at is null)
    or (initial_charge_minutes is not null and duration_confirmed_at is not null)
  ),
  constraint queue_entries_called_fields check (
    status <> 'called'
    or (assigned_slot_id is not null and called_at is not null and call_expires_at is not null)
  ),
  constraint queue_entries_charging_fields check (
    status <> 'charging'
    or (
      assigned_slot_id is not null
      and charging_started_at is not null
      and expected_finish_at is not null
      and finish_confirmation_expires_at is not null
    )
  ),
  constraint queue_entries_push_subscription_opt_in check (
    push_subscription_id is null or push_opt_in = true
  ),
  constraint queue_entries_idempotency_hash_lengths check (
    (join_idempotency_key_hash is null or octet_length(join_idempotency_key_hash) = 32)
    and (join_idempotency_fingerprint_hash is null or octet_length(join_idempotency_fingerprint_hash) = 32)
    and (last_mutation_key_hash is null or octet_length(last_mutation_key_hash) = 32)
    and (last_mutation_fingerprint_hash is null or octet_length(last_mutation_fingerprint_hash) = 32)
  ),
  constraint queue_entries_id_site_unique unique (id, charging_site_id),
  constraint queue_entries_assigned_slot_site_fkey
    foreign key (assigned_slot_id, charging_site_id)
    references public.site_slots(id, charging_site_id)
    on delete restrict
);

alter table public.site_slots
  add constraint site_slots_active_entry_id_fkey
  foreign key (active_entry_id, charging_site_id)
  references public.queue_entries(id, charging_site_id)
  on delete set null (active_entry_id);

create unique index site_slots_active_entry_unique_idx
  on public.site_slots(active_entry_id)
  where active_entry_id is not null;

create unique index queue_entries_join_idempotency_unique_idx
  on public.queue_entries(charging_site_id, join_idempotency_key_hash)
  where join_idempotency_key_hash is not null;

create index charging_sites_normalized_search_idx
  on public.charging_sites(normalized_search_text);

create unique index charging_sites_source_url_unique_idx
  on public.charging_sites(source_url)
  where source_url is not null;

create index site_slots_site_status_idx
  on public.site_slots(charging_site_id, status);

create index queue_entries_site_fifo_idx
  on public.queue_entries(charging_site_id, status, joined_at, queue_order);

create index queue_entries_site_estimate_idx
  on public.queue_entries(charging_site_id, estimated_start_at);

create index queue_entries_called_due_idx
  on public.queue_entries(call_expires_at)
  where status = 'called';

create index queue_entries_finish_due_idx
  on public.queue_entries(finish_confirmation_expires_at)
  where status = 'charging';

create index queue_entries_five_min_due_idx
  on public.queue_entries(estimated_start_at)
  where status in ('waiting', 'notified') and five_min_push_sent_at is null;

create index queue_entries_end_notice_due_idx
  on public.queue_entries(expected_finish_at)
  where status = 'charging' and charge_end_push_sent_at is null;

create or replace function public.set_charge_queue_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger charging_sites_set_updated_at
before update on public.charging_sites
for each row execute function public.set_charge_queue_updated_at();

create trigger site_slots_set_updated_at
before update on public.site_slots
for each row execute function public.set_charge_queue_updated_at();

create trigger queue_entries_set_updated_at
before update on public.queue_entries
for each row execute function public.set_charge_queue_updated_at();

alter table public.charging_sites enable row level security;
alter table public.site_slots enable row level security;
alter table public.queue_entries enable row level security;

revoke all on table public.charging_sites, public.site_slots, public.queue_entries from public;
revoke usage, select on all sequences in schema public from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.charging_sites, public.site_slots, public.queue_entries from anon';
    execute 'revoke usage, select on all sequences in schema public from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.charging_sites, public.site_slots, public.queue_entries from authenticated';
    execute 'revoke usage, select on all sequences in schema public from authenticated';
  end if;
end;
$$;

comment on table public.charging_sites is 'スパQ facility master and facility-level queue state.';
comment on table public.site_slots is 'Physical or virtual charging slots for a facility.';
comment on table public.queue_entries is 'Active queue entries only. Completed, cancelled, and expired rows are deleted.';

commit;
