-- Tests for the proposal notifications. Run AFTER all migrations.
-- People: haby (1) owns the project; ibou (2) collaborates; jaly (3) is a stranger.

create schema ppn;
grant usage on schema ppn to public;
create function ppn.uid(p_n int) returns uuid language sql immutable as $$ select ('e1f2a3b4-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function ppn.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function ppn.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := ppn.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (ppn.uid(1), 'haby-pn@exemple.sn', '{"provider":"email"}', '{}'),
  (ppn.uid(2), 'ibou-pn@exemple.sn', '{"provider":"email"}', '{}'),
  (ppn.uid(3), 'jaly-pn@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set username = 'haby_pn' where id = ppn.uid(1);
update public.profiles set username = 'ibou_pn' where id = ppn.uid(2);
update public.profiles set username = 'jaly_pn' where id = ppn.uid(3);
insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public)
values (ppn.uid(1), 'haby-pn', 'appli', 'Mon appli', now(), true);

do $$
declare p uuid; n int; d jsonb;
begin
  select id into p from public.projects where github_owner = 'haby-pn';

  -- 1. The owner is told when a collaborator proposes, once per proposal, with who, which project and which proposal
  set local role service_role;
  perform public.notify_proposal('proposal_opened', p, ppn.uid(2), 'ibou_pn', 7, 'Corrige le titre');
  perform public.notify_proposal('proposal_opened', p, ppn.uid(2), 'ibou_pn', 7, 'Corrige le titre');
  reset role;
  select count(*) into n from public.notifications where user_id = ppn.uid(1) and kind = 'proposal_opened';
  if n <> 1 then raise exception 'FAIL: the owner was told % times', n; end if;
  select data into d from public.notifications where user_id = ppn.uid(1) and kind = 'proposal_opened';
  if d ->> 'actor_username' <> 'ibou_pn' or d ->> 'project_title' <> 'Mon appli' or (d ->> 'number')::int <> 7 or d ->> 'title' <> 'Corrige le titre' or d ->> 'project_id' <> p::text then
    raise exception 'FAIL: the notification data is wrong: %', d;
  end if;
  select count(*) into n from public.notifications where user_id <> ppn.uid(1) and kind like 'proposal_%';
  if n <> 0 then raise exception 'FAIL: someone else was told'; end if;
  raise notice 'OK 1: the owner is told once about a proposal';

  -- 2. The author is told when it is merged or declined (username in any letter case)
  set local role service_role;
  perform public.notify_proposal('proposal_merged', p, ppn.uid(1), 'IBOU_PN', 7, 'Corrige le titre');
  perform public.notify_proposal('proposal_declined', p, ppn.uid(1), 'ibou_pn', 8, 'Autre idée');
  reset role;
  select count(*) into n from public.notifications where user_id = ppn.uid(2) and kind in ('proposal_merged', 'proposal_declined');
  if n <> 2 then raise exception 'FAIL: the author was told % times', n; end if;
  raise notice 'OK 2: the author is told about a merge and a refusal';

  -- 3. Nobody is told about their own action, and unknown people, projects or kinds do nothing or are refused
  set local role service_role;
  perform public.notify_proposal('proposal_opened', p, ppn.uid(1), 'haby_pn', 9, 'Mon essai');
  perform public.notify_proposal('proposal_merged', p, ppn.uid(1), 'haby_pn', 9, 'Mon essai');
  perform public.notify_proposal('proposal_merged', p, ppn.uid(1), 'personne_inconnue', 10, 'x');
  perform public.notify_proposal('proposal_merged', p, ppn.uid(1), null, 11, 'x');
  perform public.notify_proposal('proposal_opened', gen_random_uuid(), ppn.uid(2), 'ibou_pn', 12, 'x');
  perform ppn.must_fail('an unknown kind', format('select public.notify_proposal(%L, %L, %L, %L, 1, %L)', 'collab_invite', p, ppn.uid(1), 'ibou_pn', 'x'), 'Unknown proposal notification');
  reset role;
  select count(*) into n from public.notifications where kind like 'proposal_%';
  if n <> 3 then raise exception 'FAIL: % notifications exist, expected 3', n; end if;
  raise notice 'OK 3: no notification for your own action or for nobody';

  -- 4. Only the server can send them
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', ppn.uid(3)::text, true);
  perform ppn.must_fail('a member sends one', format('select public.notify_proposal(%L, %L, %L, %L, 1, %L)', 'proposal_merged', p, ppn.uid(3), 'ibou_pn', 'fake'), 'permission denied');
  reset role;
  set local role anon;
  perform ppn.must_fail('a visitor sends one', format('select public.notify_proposal(%L, %L, %L, %L, 1, %L)', 'proposal_merged', p, ppn.uid(3), 'ibou_pn', 'fake'), 'permission denied');
  reset role;
  if not ('proposal_opened' = any (public.notification_kinds()) and 'proposal_merged' = any (public.notification_kinds())
          and 'proposal_declined' = any (public.notification_kinds()) and 'souk_sale' = any (public.notification_kinds())
          and 'collab_invite_declined' = any (public.notification_kinds())) then
    raise exception 'FAIL: the list of kinds lost or missed a kind';
  end if;
  raise notice 'OK 4: only the server sends them, and the list of kinds is complete';
end $$;

delete from public.notifications where user_id::text like 'e1f2a3b4-%';
delete from public.projects where github_owner = 'haby-pn';
delete from auth.users where id::text like 'e1f2a3b4-%';
drop schema ppn cascade;
select 'ALL PROPOSAL NOTIFICATION TESTS PASSED' as result;
