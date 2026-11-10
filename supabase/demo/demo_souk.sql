-- jaajef.tech - Sample Souk items, the nine creations of Marie's screen (3 themes, 3 frames, 3 badges).
-- Run it in the Supabase SQL Editor after demo_data.sql and souk_creator_on_shop. Running it again resets them.
-- It also takes every other item off sale (the old "(exemple)" placeholders and any test items), so the shop shows
-- exactly the nine creations. People who already bought them keep them. Use only for the demo.
-- The prices are very low on purpose, so everything can be bought and tried; real prices are decided later.
-- Each theme sets the colours of the whole app when a member equips it.

delete from public.equipped_items where item_id in (select id from public.souk_items where slug like '%-demo');
delete from public.member_items where item_id in (select id from public.souk_items where slug like '%-demo');
delete from public.souk_items where slug like '%-demo';

update public.souk_items set is_active = false where slug not like '%-demo';

with makers as (
  select id, row_number() over (order by username) as n from public.profiles where username in (
    select username from public.profiles p join auth.users u on u.id = p.id where u.email like '%@demo.jaajef.invalid')
), counted as (select count(*) as c from makers),
items (slug, kind, name, description, price, data, n) as (values
  ('sahel-dore-demo', 'theme', 'Sahel Doré', E'L''or du Sahel au coucher du soleil. Chaleur et précision.', 10, '{"accent":"#f0b24a","bg":"#0d0905","glow":"#1f1608","panel":"#16100a","raised":"#201710","line":"#4a3818","lineStrong":"#8a6a24"}'::jsonb, 1),
  ('dakar-after-dark-demo', 'theme', 'Dakar After Dark', 'La ville la nuit, en violet profond.', 15, '{"accent":"#b79cf5","bg":"#0d0a1c","glow":"#1a1233","panel":"#150f2b","raised":"#1d1538","line":"#3a2a66","lineStrong":"#6a4fb5"}'::jsonb, 2),
  ('baobab-terminal-demo', 'theme', 'Baobab Terminal', 'Un terminal vert, enraciné comme un baobab.', 12, '{"accent":"#3ddba7","bg":"#06120f","glow":"#0b2119","panel":"#0b1d18","raised":"#102a22","line":"#1c4a3b","lineStrong":"#2a8a6c"}'::jsonb, 3),
  ('cercle-du-saltigue-demo', 'avatar_frame', 'Cercle du Saltigué', 'Un cercle qui veille sur votre avatar.', 8, '{"color":"#3fb8f0"}'::jsonb, 4),
  ('gardien-de-la-cite-demo', 'avatar_frame', 'Gardien de la Cité', 'Un cadre sobre, pour ceux qui protègent.', 20, '{"color":"#b79cf5"}'::jsonb, 5),
  ('lueur-de-la-teranga-demo', 'avatar_frame', 'Lueur de la Teranga', 'La chaleur de l''accueil, en vert.', 9, '{"color":"#3ddba7"}'::jsonb, 6),
  ('sceau-du-griot-demo', 'status_badge', 'Sceau du Griot', 'Le sceau de ceux qui racontent en code.', 6, '{"color":"#3fb8f0","label":"CLASS SEAL"}'::jsonb, 7),
  ('oeil-du-baobab-demo', 'status_badge', 'Œil du Baobab', 'Voir loin, comprendre tôt.', 8, '{"color":"#b79cf5","label":"CLASS SEAL"}'::jsonb, 8),
  ('linguere-legendaire-demo', 'status_badge', 'Linguère Légendaire', 'Réservé aux légendes de la Cité.', 30, '{"color":"#f0b24a","label":"LEGENDARY"}'::jsonb, 9)
)
insert into public.souk_items (slug, kind, name, description, price_kopeks, data, creator_id)
select i.slug, i.kind::public.souk_item_kind, i.name, i.description, i.price, i.data,
       (select m.id from makers m, counted where m.n = ((i.n - 1) % greatest(counted.c, 1)) + 1)
  from items i;
