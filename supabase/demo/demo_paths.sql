-- jaajef.tech - Sample learning paths (one per clan, a few short lessons each).
-- Run it in the Supabase SQL Editor after learning_paths. Running it again resets these sample paths.
-- The lessons are placeholders to see the screens; the real content comes later.
-- A step is linked to a published quest of the same clan when there is one.

delete from public.learning_paths where slug like '%-demo';

insert into public.learning_paths (slug, clan, title, summary, position, published) values
  ('griot-du-code-demo', 'griot_du_code', 'Devenir Griot du Code', 'Les bases du code, pas à pas, de la première variable au premier projet.', 1, true),
  ('forgeron-demo', 'forgeron', 'Devenir Forgeron', 'Façonner des interfaces claires et belles.', 2, true),
  ('saltigue-demo', 'saltigue', 'Devenir Saltigué', 'Lire les données et en tirer du sens.', 3, true),
  ('buur-linguere-demo', 'buur_linguere', 'Devenir Buur/Lingeer', 'Protéger les systèmes et les faire tenir debout.', 4, true);

insert into public.learning_steps (path_id, position, title, lesson_md, mastery, est_minutes, quest_id)
select p.id, s.n, s.title, s.body, 'ndongo', s.mins,
       case when s.n = 2 then (select q.id from public.quests q where q.clan = p.clan and q.published order by q.created_at limit 1) end
  from public.learning_paths p
  cross join (values
    (1, 'Bienvenue dans le parcours', E'# Bienvenue\n\nCe parcours vous guide pas à pas.\n\n- Une leçon courte\n- Une quête pour pratiquer\n\nPrenez votre temps.', 5),
    (2, 'Premier pas', E'Chaque étape tient en quelques minutes.\n\nSi l''étape a une quête, résolvez-la pour la terminer.', 10),
    (3, 'Aller plus loin', E'Bravo, vous avez fait le tour du fonctionnement.\n\nLe vrai contenu du parcours arrive bientôt.', 5)
  ) as s(n, title, body, mins)
 where p.slug like '%-demo';
