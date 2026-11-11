-- jaajef.tech - Six more Souk themes, in other colours (coral, red earth, hibiscus pink, savanna green, indigo, silver).
-- Run it in the Supabase SQL Editor AFTER demo_souk.sql (running demo_souk.sql again removes them). Running this one again resets only these six.
-- Prices are very low on purpose so everything can be bought and tried. Real prices and the final list of themes are decided later.

delete from public.equipped_items where item_id in (select id from public.souk_items where slug in ('corail-de-goree-demo', 'laterite-demo', 'hibiscus-demo', 'savane-demo', 'indigo-des-nuits-demo', 'argent-du-fleuve-demo'));
delete from public.member_items where item_id in (select id from public.souk_items where slug in ('corail-de-goree-demo', 'laterite-demo', 'hibiscus-demo', 'savane-demo', 'indigo-des-nuits-demo', 'argent-du-fleuve-demo'));
delete from public.souk_items where slug in ('corail-de-goree-demo', 'laterite-demo', 'hibiscus-demo', 'savane-demo', 'indigo-des-nuits-demo', 'argent-du-fleuve-demo');

with makers as (
  select id, row_number() over (order by username) as n from public.profiles where username in (
    select username from public.profiles p join auth.users u on u.id = p.id where u.email like '%@demo.jaajef.invalid')
), counted as (select count(*) as c from makers),
items (slug, kind, name, description, price, data, n) as (values
  ('corail-de-goree-demo', 'theme', 'Corail de Gorée', 'Le rose corail des maisons de l''île de Gorée.', 8, '{"accent":"#ff7a8a","bg":"#110607","glow":"#220a0d","panel":"#1d0a0c","raised":"#270e12","line":"#491d23","lineStrong":"#8c3642"}'::jsonb, 1),
  ('laterite-demo', 'theme', 'Latérite', 'La terre rouge du Sénégal, chaude et vive.', 9, '{"accent":"#ff6b3d","bg":"#110806","glow":"#220f0a","panel":"#1d0e0a","raised":"#27140e","line":"#49271d","lineStrong":"#8c4a36"}'::jsonb, 2),
  ('hibiscus-demo', 'theme', 'Hibiscus', 'La fleur de bissap, en rose profond.', 10, '{"accent":"#e85fb0","bg":"#11060c","glow":"#220a18","panel":"#1d0a15","raised":"#270e1d","line":"#491d37","lineStrong":"#8c3668"}'::jsonb, 3),
  ('savane-demo', 'theme', 'Savane', 'Le vert doré de la savane après la pluie.', 9, '{"accent":"#b8d94a","bg":"#0f1106","glow":"#1d220a","panel":"#191d0a","raised":"#22270e","line":"#40491d","lineStrong":"#7a8c36"}'::jsonb, 4),
  ('indigo-des-nuits-demo', 'theme', 'Indigo des Nuits', 'Le bleu indigo des nuits sans lune.', 12, '{"accent":"#7c8cff","bg":"#060711","glow":"#0a0d22","panel":"#0a0c1d","raised":"#0e1227","line":"#1d2349","lineStrong":"#36428c"}'::jsonb, 5),
  ('argent-du-fleuve-demo', 'theme', 'Argent du Fleuve', 'Le reflet argenté du fleuve Sénégal. Sobre et neutre.', 7, '{"accent":"#c3ccd8","bg":"#0a0b0d","glow":"#12151a","panel":"#101316","raised":"#171a1f","line":"#2c323a","lineStrong":"#535f6f"}'::jsonb, 6)
)
insert into public.souk_items (slug, kind, name, description, price_kopeks, data, creator_id)
select i.slug, i.kind::public.souk_item_kind, i.name, i.description, i.price, i.data,
       (select m.id from makers m, counted where m.n = ((i.n - 1) % greatest(counted.c, 1)) + 1)
  from items i;
