-- Docketlight schema. Firm isolation, stage rules and the audit chain all live here,
-- so they hold even if application code is bypassed.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;
grant app_user to current_user;
grant usage on schema public to app_user;

-- Per-request context, set with set_config(..., true) inside each transaction.
create function current_firm() returns uuid language sql stable as
  $$ select nullif(current_setting('app.firm_id', true), '')::uuid $$;
create function current_app_role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;

create table firms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sms_number text not null unique,
  timezone text not null default 'America/New_York',
  demo_now timestamptz not null default now()
);

create table firm_settings (
  firm_id uuid primary key references firms on delete cascade,
  contact_phone text not null,
  contact_email text not null,
  lockout_lead_days int not null default 5
);

create table users (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'team'))
);

create table owners (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  name text not null,
  phone text not null,
  timezone text not null,
  consent text not null default 'none' check (consent in ('none', 'pending', 'opted_in', 'opted_out')),
  opt_in_requested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (firm_id, phone)
);

create table consent_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  owner_id uuid not null references owners on delete cascade,
  kind text not null check (kind in ('opt_in', 'opt_out', 're_opt_in')),
  method text not null,
  keyword text,
  consent_text text,
  at timestamptz not null
);

-- Stage order and allowed moves are data, read by the guard trigger below.
create table stages (
  code text primary key,
  display_no text not null,
  name text not null,
  tone text not null check (tone in ('neutral', 'good', 'bad', 'warn')),
  sort int not null unique,
  is_terminal boolean not null default false,
  sends_text boolean not null default true,
  default_template text
);

create table stage_transitions (
  from_stage text not null references stages,
  to_stage text not null references stages,
  label text not null,
  primary key (from_stage, to_stage)
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  owner_id uuid not null references owners on delete cascade,
  case_number text not null,
  county text not null,
  filing_date date not null,
  address text not null,
  resident_name text not null,
  stage text not null default 'filed' references stages,
  -- A result the team has recorded but not yet sent to the owner (the team screen's groups).
  pending_stage text references stages,
  paused_from text references stages,
  court_at timestamptz,
  possession_at timestamptz,
  writ_filed_at timestamptz,
  reply_deadline timestamptz,
  lockout_at timestamptz,
  keys_held_until timestamptz,
  closed_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (firm_id, county, case_number)
);
create index cases_firm_stage on cases (firm_id, stage);
create index cases_firm_pending on cases (firm_id, pending_stage);

create table templates (
  firm_id uuid not null references firms on delete cascade,
  stage_code text not null references stages,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (firm_id, stage_code)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  firm_id uuid not null references firms on delete cascade,
  owner_id uuid not null references owners on delete cascade,
  case_id uuid references cases on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  kind text not null check (kind in ('stage', 'opt_in', 'compliance', 'decision', 'reply')),
  stage_code text references stages,
  body text not null,
  -- held_opt_in: waiting for YES. queued: waiting for send_after. blocked: never sent.
  status text not null check (status in ('held_opt_in', 'queued', 'sent', 'blocked', 'received')),
  send_after timestamptz,
  quiet_held boolean not null default false,
  block_reason text,
  created_at timestamptz not null,
  sent_at timestamptz,
  provider_id text,
  -- Order the owner actually saw them in. A held text is created early but delivered late.
  delivered_seq bigint
);
create index messages_owner on messages (firm_id, owner_id, seq);
create index messages_due on messages (firm_id, status, send_after);

create table decision_tokens (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  case_id uuid not null references cases on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms on delete cascade,
  case_id uuid not null unique references cases on delete cascade,
  choice text not null check (choice in ('STAY', 'LOCKOUT')),
  channel text not null check (channel in ('sms', 'link')),
  decided_by text not null,
  decided_at timestamptz not null
);

create table subscriptions (
  firm_id uuid primary key references firms on delete cascade,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'read_only', 'canceled')),
  trial_ends_at timestamptz,
  trial_ending_notice boolean not null default false,
  grace_ends_at timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);

-- Webhook idempotency. Only the system connection touches this, never a firm request.
create table processed_events (
  event_id text primary key,
  type text not null,
  firm_id uuid references firms on delete set null,
  source text not null,
  processed_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms,
  seq bigint not null,
  at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  actor text not null,
  action text not null,
  case_id uuid,
  detail jsonb not null default '{}',
  prev_hash text not null,
  hash text not null,
  unique (firm_id, seq)
);
create index audit_firm_action on audit_log (firm_id, action);
