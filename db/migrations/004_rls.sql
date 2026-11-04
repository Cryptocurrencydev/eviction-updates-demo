-- Row level security. Each request runs as app_user with app.firm_id set, so a query
-- that forgets a WHERE clause still sees one firm. No firm set means no rows.
-- The table owner (migrations, seed, webhook lookups) is the only role that bypasses this.
do $$
declare t text;
begin
  foreach t in array array['users','owners','consent_events','cases','messages','decision_tokens','decisions','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy firm_isolation on %I using (firm_id = current_firm()) with check (firm_id = current_firm())', t);
  end loop;
  -- Billing, team settings and templates: everyone reads, only admins write.
  foreach t in array array['firm_settings','templates','subscriptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy firm_read on %I for select using (firm_id = current_firm())', t);
    execute format($p$create policy admin_write on %I for all
      using (firm_id = current_firm() and current_app_role() = 'admin')
      with check (firm_id = current_firm() and current_app_role() = 'admin')$p$, t);
  end loop;
end $$;

alter table firms enable row level security;
create policy firm_self on firms using (id = current_firm()) with check (id = current_firm());

grant usage on sequence messages_delivered_seq to app_user;
grant select on stages, stage_transitions to app_user;
grant select on firms to app_user;
grant update (demo_now) on firms to app_user;
grant select on users to app_user;
grant select, insert, update on owners, cases, messages, decision_tokens to app_user;
grant select, insert on consent_events, decisions to app_user;
grant select, insert, update on firm_settings, templates, subscriptions to app_user;
-- Append-only by privilege as well as by trigger.
grant select, insert on audit_log to app_user;
