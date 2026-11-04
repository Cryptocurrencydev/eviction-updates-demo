-- The demo clock. Everything time-based reads this, so fast-forwarding is honest.
create function firm_now() returns timestamptz language sql stable as
  $$ select demo_now from firms where id = current_firm() $$;

-- Read-only mode: cases stay visible, advancing and texting stop.
create function firm_read_only() returns boolean language sql stable as $$
  select exists (
    select 1 from subscriptions s join firms f on f.id = s.firm_id
    where s.firm_id = current_firm()
      and (s.status in ('read_only', 'canceled')
           or (s.status = 'past_due' and s.grace_ends_at is not null and s.grace_ends_at <= f.demo_now))
  )
$$;

-- Guards every write to a case, whichever path it came through.
-- Custom SQLSTATEs: DL001 invalid transition, DL002 missing field, DL003 read-only, DL404 not found.
create function cases_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'app_user' and new.stage <> 'filed' then
      raise exception 'new cases must start at filed, not %', new.stage using errcode = 'DL001';
    end if;
    return new;
  end if;

  if new.stage is distinct from old.stage or new.pending_stage is distinct from old.pending_stage then
    if current_user = 'app_user' and firm_read_only() then
      raise exception 'firm is in read-only mode' using errcode = 'DL003';
    end if;
  end if;

  if new.stage is distinct from old.stage then
    if not exists (select 1 from stage_transitions t where t.from_stage = old.stage and t.to_stage = new.stage) then
      raise exception 'transition % -> % is not allowed', old.stage, new.stage using errcode = 'DL001';
    end if;
    if old.stage = 'appeal_filed' and new.stage is distinct from old.paused_from then
      raise exception 'an appeal can only resume to %, not %', old.paused_from, new.stage using errcode = 'DL001';
    end if;
    -- Only the owner's recorded choice can take a case out of the writ stage forward.
    if old.stage = 'writ_filed' and new.stage in ('stay_closed', 'lockout_scheduled') and not exists (
      select 1 from decisions d where d.case_id = new.id
        and d.choice = case new.stage when 'stay_closed' then 'STAY' else 'LOCKOUT' end
    ) then
      raise exception 'no recorded owner decision for %', new.stage using errcode = 'DL001';
    end if;
  end if;

  if new.pending_stage is not null and not exists (
    select 1 from stage_transitions t where t.from_stage = new.stage and t.to_stage = new.pending_stage
  ) then
    raise exception 'result % cannot follow stage %', new.pending_stage, new.stage using errcode = 'DL001';
  end if;
  return new;
end $$;

create trigger cases_guard before insert or update on cases
  for each row execute function cases_guard();

-- Audit chain
create function audit_hash(
  p_firm uuid, p_seq bigint, p_at timestamptz, p_actor text, p_action text,
  p_case uuid, p_detail jsonb, p_prev text
) returns text language sql immutable as $$
  select encode(sha256(convert_to(
    p_firm::text || '|' || p_seq::text || '|' ||
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
    p_actor || '|' || p_action || '|' || coalesce(p_case::text, '') || '|' ||
    p_detail::text || '|' || p_prev, 'UTF8')), 'hex')
$$;

create function audit_chain() returns trigger language plpgsql as $$
declare
  last_seq bigint;
  last_hash text;
begin
  -- One writer at a time per firm, so two requests can't fork the chain.
  perform pg_advisory_xact_lock(hashtextextended(new.firm_id::text, 7741));
  select seq, hash into last_seq, last_hash from audit_log
    where firm_id = new.firm_id order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  if new.at is null then
    select demo_now into new.at from firms where id = new.firm_id;
  end if;
  new.hash := audit_hash(new.firm_id, new.seq, new.at, new.actor, new.action, new.case_id, new.detail, new.prev_hash);
  return new;
end $$;

create trigger audit_chain before insert on audit_log
  for each row execute function audit_chain();

create function audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = 'DL005';
end $$;

create trigger audit_no_update before update or delete on audit_log
  for each row execute function audit_immutable();
create trigger audit_no_truncate before truncate on audit_log
  for each statement execute function audit_immutable();

-- Recomputes every hash from the stored fields, oldest first.
create function verify_audit_chain()
returns table (ok boolean, checked bigint, first_bad_seq bigint)
language plpgsql stable as $$
declare
  r record;
  expected_prev text := repeat('0', 64);
  expected_seq bigint := 1;
  n bigint := 0;
begin
  for r in select * from audit_log where firm_id = current_firm() order by seq loop
    n := n + 1;
    if r.seq <> expected_seq or r.prev_hash <> expected_prev
       or r.hash <> audit_hash(r.firm_id, r.seq, r.at, r.actor, r.action, r.case_id, r.detail, r.prev_hash) then
      return query select false, n, r.seq;
      return;
    end if;
    expected_prev := r.hash;
    expected_seq := r.seq + 1;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- The one way a case moves. The guard trigger enforces the rules; this adds the
-- per-stage fields and the audit row in the same transaction.
create function advance_case(p_case uuid, p_to text, p_actor text, p_fields jsonb default '{}')
returns cases language plpgsql as $$
declare
  c cases;
  from_stage text;
  t timestamptz := firm_now();
  deadline timestamptz := (p_fields->>'reply_deadline')::timestamptz;
  new_court timestamptz := (p_fields->>'court_at')::timestamptz;
  lockout timestamptz := (p_fields->>'lockout_at')::timestamptz;
begin
  select * into c from cases where id = p_case for update;
  if not found then
    raise exception 'case not found' using errcode = 'DL404';
  end if;
  from_stage := c.stage;

  if p_to = 'writ_filed' and deadline is null then
    raise exception 'a reply-by deadline is required to file the writ' using errcode = 'DL002';
  end if;
  if p_to = 'continued_new_date' and new_court is null then
    raise exception 'a new court date is required' using errcode = 'DL002';
  end if;
  if deadline <= t or new_court <= t then
    raise exception 'that date has already passed' using errcode = 'DL002';
  end if;
  if p_to = 'lockout_scheduled' and lockout is null and c.lockout_at is null then
    raise exception 'a lockout date is required' using errcode = 'DL002';
  end if;

  update cases set
    stage = p_to,
    pending_stage = null,
    stage_changed_at = t,
    paused_from = case when p_to = 'appeal_filed' then from_stage else null end,
    court_at = coalesce(new_court, court_at),
    possession_at = case when p_to = 'possession_won' and possession_at is null then t else possession_at end,
    writ_filed_at = case when p_to = 'writ_filed' then t else writ_filed_at end,
    reply_deadline = coalesce(deadline, reply_deadline),
    lockout_at = coalesce(lockout, lockout_at),
    keys_held_until = case when p_to = 'lockout_complete' then t + interval '7 days' else keys_held_until end,
    closed_at = case when (select is_terminal from stages where code = p_to) then t else closed_at end
  where id = p_case
  returning * into c;

  insert into audit_log (firm_id, actor, action, case_id, detail, at)
  values (c.firm_id, p_actor, 'case.advanced', c.id,
          jsonb_build_object('case_number', c.case_number, 'from', from_stage, 'to', p_to), t);
  return c;
end $$;

-- Stamps delivery order the moment a text is sent or received.
create sequence messages_delivered_seq;
create function messages_stamp_delivery() returns trigger language plpgsql as $$
begin
  if new.status in ('sent', 'received') and new.delivered_seq is null then
    new.delivered_seq := nextval('messages_delivered_seq');
  end if;
  return new;
end $$;
create trigger messages_stamp_delivery before insert or update on messages
  for each row execute function messages_stamp_delivery();
