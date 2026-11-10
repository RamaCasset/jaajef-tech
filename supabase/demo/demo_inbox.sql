-- jaajef.tech - SAMPLE MESSAGES for the chat inbox (so the Messages page and the chat button have something to show).
--
-- Run it AFTER demo_data.sql. It does this for every REAL member (anyone whose e-mail is not a sample one):
--   - makes them a member of 3 sample communities (GameDev Senegal, IA & Data Lab, Web Dev Dakar), whose messages then show as unread;
--   - gives them a project room for the sample project Teranga Racer, with a few unread messages;
--   - starts 3 private conversations with sample members, with unread messages.
-- Running it again resets these. demo_data_remove.sql removes all of it, because it deletes the sample members
-- and everything they own (the rooms and the conversations go with them).

begin;

-- Start clean: earlier sample conversations and the sample project room.
delete from public.conversations c
 where exists (select 1 from auth.users u where u.id in (c.user_a, c.user_b) and u.email like '%@demo.jaajef.invalid');
delete from public.communities where slug = 'salon-teranga-racer-demo';

create function pg_temp.uid(n int) returns uuid language sql immutable as
$$ select ('de000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- The real members.
create temp table real_members on commit drop as
  select u.id from auth.users u
   where u.email not like '%@demo.jaajef.invalid'
     and exists (select 1 from public.profiles p where p.id = u.id);

-- 1. Sample communities: joined two days ago, so their messages count as unread.
insert into public.community_members (community_id, user_id, role, joined_at)
select ('de000000-0000-4000-9000-00000000000' || c)::uuid, r.id, 'member', now() - interval '2 days'
  from real_members r cross join generate_series(1, 3) c
on conflict (community_id, user_id) do update set joined_at = excluded.joined_at;

-- Forget earlier "read" marks, so the unread counts come back.
delete from public.channel_reads where user_id in (select id from real_members);

-- 2. A project room, like the one a project opens for its collaborators.
insert into public.communities (id, slug, name, description, is_private, is_listed, owner_id, project_id)
values ('de000000-0000-4000-9000-000000000090', 'salon-teranga-racer-demo', 'Salon : Teranga Racer', 'Le salon du projet Teranga Racer.', true, false,
        pg_temp.uid(2), 'de000000-0000-4000-c000-000000000001');
insert into public.channels (id, community_id, slug, name, kind)
values ('de000000-0000-4000-a000-000000000901', 'de000000-0000-4000-9000-000000000090', 'general', 'general', 'chat');
insert into public.community_members (community_id, user_id, role, joined_at)
select 'de000000-0000-4000-9000-000000000090', pg_temp.uid(2), 'owner', now() - interval '10 days';
insert into public.community_members (community_id, user_id, role, joined_at)
select 'de000000-0000-4000-9000-000000000090', pg_temp.uid(1), 'member', now() - interval '9 days';
insert into public.community_members (community_id, user_id, role, joined_at)
select 'de000000-0000-4000-9000-000000000090', id, 'member', now() - interval '2 days' from real_members;
insert into public.messages (channel_id, community_id, author_id, body, created_at) values
  ('de000000-0000-4000-a000-000000000901', 'de000000-0000-4000-9000-000000000090', pg_temp.uid(2), 'Salon du projet ouvert. On y met les décisions et les questions.', now() - interval '1 day'),
  ('de000000-0000-4000-a000-000000000901', 'de000000-0000-4000-9000-000000000090', pg_temp.uid(1), 'Les nouvelles maquettes du circuit sont prêtes, je les pousse ce soir.', now() - interval '5 hours'),
  ('de000000-0000-4000-a000-000000000901', 'de000000-0000-4000-9000-000000000090', pg_temp.uid(2), 'Parfait, je fais la revue demain matin.', now() - interval '4 hours');

-- 3. Private conversations with three sample members.
insert into public.conversations (user_a, user_b, created_at, last_message_at)
select least(r.id, pg_temp.uid(d.n)), greatest(r.id, pg_temp.uid(d.n)), now() - interval '3 days', now() - d.ago
  from real_members r
  cross join (values (1, interval '40 minutes'), (2, interval '6 hours'), (3, interval '2 days')) as d(n, ago);

insert into public.direct_messages (conversation_id, sender_id, body, created_at)
select c.id, case when m.mine then r.id else pg_temp.uid(m.n) end, m.body, now() - m.ago
  from real_members r
  cross join (values
    (1, false, 'Salut ! J''ai vu ton projet, bravo pour l''interface.', interval '3 hours'),
    (1, true,  'Merci Awa ! Tu veux qu''on travaille ensemble sur les couleurs ?', interval '2 hours'),
    (1, false, 'Avec plaisir. Je t''envoie une première palette ce soir.', interval '40 minutes'),
    (2, true,  'Bonjour Moussa, une question sur la boucle de jeu.', interval '8 hours'),
    (2, false, 'Bien sûr, dis-moi. Le mouvement dépend du temps écoulé entre deux images.', interval '6 hours'),
    (3, false, 'Bienvenue dans la Cité ! N''hésite pas si tu as besoin d''un coup de main sur les données.', interval '2 days')
  ) as m(n, mine, body, ago)
  join public.conversations c on c.user_a = least(r.id, pg_temp.uid(m.n)) and c.user_b = greatest(r.id, pg_temp.uid(m.n));

-- Awa's first message was read; the others are all still unread.
update public.conversations c set
  a_read_at = case when exists (select 1 from real_members r where r.id = c.user_a) and c.user_b = pg_temp.uid(1) then now() - interval '4 hours' else a_read_at end,
  b_read_at = case when exists (select 1 from real_members r where r.id = c.user_b) and c.user_a = pg_temp.uid(1) then now() - interval '4 hours' else b_read_at end
 where exists (select 1 from auth.users u where u.id in (c.user_a, c.user_b) and u.email like '%@demo.jaajef.invalid');

commit;
