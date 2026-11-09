-- jaajef.tech - SAMPLE DATA for the demo (members, communities, questions, projects, blog).
--
-- Run it in the Supabase SQL Editor. It first removes any earlier sample data, then adds a fresh set,
-- so running it twice is fine. To take it all out again, run demo_data_remove.sql.
-- None of these members can sign in (no password), and none of this is real activity.
-- The sample projects point to a GitHub account that does not exist, so their GitHub links lead nowhere.

begin;

delete from auth.users where email like '%@demo.jaajef.invalid';

-- ---------------------------------------------------------------------
-- 10 sample members
-- ---------------------------------------------------------------------
create function pg_temp.uid(n int) returns uuid language sql immutable as
$$ select ('de000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(n), e, '{"provider":"email","providers":["email"]}', '{}'
  from (values
    (1, 'awa.diallo@demo.jaajef.invalid'), (2, 'moussa.diop@demo.jaajef.invalid'), (3, 'fatou.ndiaye@demo.jaajef.invalid'),
    (4, 'cheikh.sow@demo.jaajef.invalid'), (5, 'aminata.ba@demo.jaajef.invalid'), (6, 'ibrahima.fall@demo.jaajef.invalid'),
    (7, 'khady.mbaye@demo.jaajef.invalid'), (8, 'modou.sarr@demo.jaajef.invalid'), (9, 'sokhna.gueye@demo.jaajef.invalid'),
    (10, 'pape.thiam@demo.jaajef.invalid')
  ) as t(n, e);

-- The sign-up trigger already created a profile and a wallet for each; fill them in.
update public.profiles p set
  username = v.username, display_name = v.display_name, bio = v.bio, location = v.location, region = v.region,
  clan = v.clan::public.clan_type, mastery = v.mastery::public.mastery_type, xp = v.xp, streak_days = v.streak,
  available_to_collab = v.collab, onboarding_step = 4, last_active_on = current_date
from (values
  (1, 'awa_diallo', 'Awa Diallo', 'Designer d''interfaces et de jeux. J''aime les couleurs du Sénégal.', 'Dakar', 'dakar', 'forgeron', 'bagne', 4200, 12, true),
  (2, 'moussa_diop', 'Moussa Diop', 'Ingénieur logiciel. Je construis des jeux web et des outils pour les développeurs.', 'Dakar', 'dakar', 'griot_du_code', 'borom_xam_xam', 8450, 31, true),
  (3, 'fatou_ndiaye', 'Fatou Ndiaye', 'Data scientist. Modèles de langue pour le wolof.', 'Thiès', 'thies', 'saltigue', 'bagne', 5100, 9, true),
  (4, 'cheikh_sow', 'Cheikh Sow', 'Sécurité et DevOps. Je protège ce que les autres construisent.', 'Saint-Louis', 'saint_louis', 'buur_linguere', 'borom_xam_xam', 7300, 22, false),
  (5, 'aminata_ba', 'Aminata Bâ', 'Étudiante en informatique, je découvre Python et le web.', 'Kaolack', 'kaolack', 'griot_du_code', 'ndongo', 900, 4, true),
  (6, 'ibrahima_fall', 'Ibrahima Fall', 'Designer 3D et motion.', 'Ziguinchor', 'ziguinchor', 'forgeron', 'bagne', 2600, 6, true),
  (7, 'khady_mbaye', 'Khady Mbaye', 'Apprentie en analyse de données, depuis la diaspora.', 'Paris', 'diaspora', 'saltigue', 'ndongo', 1200, 3, true),
  (8, 'modou_sarr', 'Modou Sarr', 'Développeur mobile Flutter.', 'Louga', 'louga', 'griot_du_code', 'bagne', 3800, 15, true),
  (9, 'sokhna_gueye', 'Sokhna Gueye', 'DevOps, conteneurs et pipelines.', 'Dakar', 'dakar', 'buur_linguere', 'bagne', 3300, 8, false),
  (10, 'pape_thiam', 'Pape Thiam', 'Premier projet open source en cours.', 'Thiès', 'thies', 'griot_du_code', 'ndongo', 600, 2, true)
) as v(n, username, display_name, bio, location, region, clan, mastery, xp, streak, collab)
where p.id = pg_temp.uid(v.n);

update public.wallets set kopeks = 100 + (random() * 900)::int where user_id in (select pg_temp.uid(n) from generate_series(1, 10) n);

-- ---------------------------------------------------------------------
-- 5 starter communities, with rooms, members and a little conversation
-- ---------------------------------------------------------------------
insert into public.communities (id, slug, name, description, is_private, owner_id, created_at) values
  ('de000000-0000-4000-9000-000000000001', 'gamedev-senegal', 'GameDev Senegal', 'L''atelier des créateurs de jeux.', false, pg_temp.uid(2), now() - interval '30 days'),
  ('de000000-0000-4000-9000-000000000002', 'ia-data-lab', 'IA & Data Lab', 'Données, modèles et langues africaines.', false, pg_temp.uid(3), now() - interval '28 days'),
  ('de000000-0000-4000-9000-000000000003', 'web-dev-dakar', 'Web Dev Dakar', 'Le web, du premier div au déploiement.', false, pg_temp.uid(1), now() - interval '26 days'),
  ('de000000-0000-4000-9000-000000000004', 'mobile-flutter', 'Mobile & Flutter', 'Applications mobiles pour tous les réseaux.', false, pg_temp.uid(8), now() - interval '20 days'),
  ('de000000-0000-4000-9000-000000000005', 'cyber-teranga', 'Cyber Teranga', 'Sécurité et DevOps. Sur demande.', true, pg_temp.uid(4), now() - interval '18 days');

insert into public.community_members (community_id, user_id, role)
select c.id, pg_temp.uid(m.n), m.role
  from (values
    (1, 2, 'owner'), (1, 1, 'moderator'), (1, 6, 'member'), (1, 8, 'member'), (1, 10, 'member'), (1, 5, 'member'),
    (2, 3, 'owner'), (2, 7, 'member'), (2, 2, 'member'), (2, 5, 'member'),
    (3, 1, 'owner'), (3, 2, 'member'), (3, 5, 'member'), (3, 10, 'member'), (3, 6, 'member'), (3, 8, 'member'),
    (4, 8, 'owner'), (4, 2, 'member'), (4, 10, 'member'),
    (5, 4, 'owner'), (5, 9, 'moderator'), (5, 2, 'member')
  ) as m(c, n, role)
  join public.communities c on c.id = ('de000000-0000-4000-9000-00000000000' || m.c)::uuid;

insert into public.channels (id, community_id, slug, name, kind)
select ('de000000-0000-4000-a000-0000000000' || lpad((c * 10 + k)::text, 2, '0'))::uuid,
       ('de000000-0000-4000-9000-00000000000' || c)::uuid, s, s, kind
  from generate_series(1, 5) c
  cross join (values (1, 'general', 'chat'), (2, 'annonces', 'announcement')) as r(k, s, kind);
insert into public.channels (id, community_id, slug, name, kind) values
  ('de000000-0000-4000-a000-000000000093', 'de000000-0000-4000-9000-000000000001', 'showcase', 'showcase', 'chat');

insert into public.messages (channel_id, community_id, author_id, body, created_at) values
  ('de000000-0000-4000-a000-000000000011', 'de000000-0000-4000-9000-000000000001', pg_temp.uid(1), 'Le prototype de Teranga Racer est prêt ! J''ai ajouté le circuit de la Corniche. @moussa_diop tu peux vérifier la boucle de déplacement ?', now() - interval '3 hours'),
  ('de000000-0000-4000-a000-000000000011', 'de000000-0000-4000-9000-000000000001', pg_temp.uid(2), E'Oui ! Le mouvement est maintenant indépendant du framerate :\n```typescript\nfunction update(delta: number) {\n  player.position.x += speed * delta;\n  requestAnimationFrame(tick);\n}\n```', now() - interval '2 hours 50 minutes'),
  ('de000000-0000-4000-a000-000000000011', 'de000000-0000-4000-9000-000000000001', pg_temp.uid(6), 'Je prépare les textures du circuit, je les poste ici demain.', now() - interval '2 hours'),
  ('de000000-0000-4000-a000-000000000011', 'de000000-0000-4000-9000-000000000001', pg_temp.uid(8), 'Quelqu''un a testé Godot 4 sur un vieux téléphone Android ? Je cherche des retours sur la fluidité.', now() - interval '1 hour'),
  ('de000000-0000-4000-a000-000000000012', 'de000000-0000-4000-9000-000000000001', pg_temp.uid(2), 'Rendez-vous samedi à 16h pour la première game jam de la communauté. Thème : « Teranga ».', now() - interval '1 day'),
  ('de000000-0000-4000-a000-000000000021', 'de000000-0000-4000-9000-000000000002', pg_temp.uid(3), 'Bonne nouvelle : le jeu de données wolof-texte atteint 50 000 phrases. Merci à toutes les personnes qui ont relu.', now() - interval '5 hours'),
  ('de000000-0000-4000-a000-000000000021', 'de000000-0000-4000-9000-000000000002', pg_temp.uid(7), E'Je teste un petit script de nettoyage :\n```python\nimport re\n\ndef clean(text):\n    return re.sub(r"\\s+", " ", text).strip()\n```', now() - interval '4 hours'),
  ('de000000-0000-4000-a000-000000000021', 'de000000-0000-4000-9000-000000000002', pg_temp.uid(2), 'Pense aussi à retirer les doublons avant l''entraînement.', now() - interval '3 hours 30 minutes'),
  ('de000000-0000-4000-a000-000000000031', 'de000000-0000-4000-9000-000000000003', pg_temp.uid(1), 'Bienvenue à Aminata et Pape, qui nous rejoignent cette semaine !', now() - interval '6 hours'),
  ('de000000-0000-4000-a000-000000000031', 'de000000-0000-4000-9000-000000000003', pg_temp.uid(5), 'Merci ! Je commence par un site statique pour ma famille. Par où me conseillez-vous de partir ?', now() - interval '5 hours 30 minutes'),
  ('de000000-0000-4000-a000-000000000031', 'de000000-0000-4000-9000-000000000003', pg_temp.uid(6), 'HTML et CSS d''abord, puis un peu de JavaScript. Et mets-le en ligne tôt, c''est motivant.', now() - interval '5 hours'),
  ('de000000-0000-4000-a000-000000000041', 'de000000-0000-4000-9000-000000000004', pg_temp.uid(8), 'Pour les réseaux lents, pensez à mettre les données en cache avec un simple Map :', now() - interval '8 hours'),
  ('de000000-0000-4000-a000-000000000041', 'de000000-0000-4000-9000-000000000004', pg_temp.uid(10), 'Ça marche aussi pour les images ?', now() - interval '7 hours'),
  ('de000000-0000-4000-a000-000000000051', 'de000000-0000-4000-9000-000000000005', pg_temp.uid(4), 'Rappel : on ne publie jamais une clé d''accès dans un dépôt. Même par erreur, même un instant.', now() - interval '1 day 2 hours');

-- ---------------------------------------------------------------------
-- Questions and answers (some in a community, some for the whole City)
-- ---------------------------------------------------------------------
insert into public.questions (id, author_id, community_id, title, body, tags, created_at) values
  ('de000000-0000-4000-b000-000000000001', pg_temp.uid(5), null, 'Comment lire un fichier JSON en Python ?', E'Je veux charger un fichier **data.json** et lire ses clés.\n\n```python\nimport json\n```\n\nPar où commencer ?', '{python,json}', now() - interval '3 days'),
  ('de000000-0000-4000-b000-000000000002', pg_temp.uid(10), 'de000000-0000-4000-9000-000000000003', 'Pourquoi mon composant React se rafraîchit sans cesse ?', E'Mon composant appelle une API et se recharge en boucle.\n\n```javascript\nuseEffect(() => {\n  fetchData().then(setData)\n})\n```\n\nQu''est-ce que je fais de travers ?', '{react,hooks,javascript}', now() - interval '2 days'),
  ('de000000-0000-4000-b000-000000000003', pg_temp.uid(7), 'de000000-0000-4000-9000-000000000002', 'Comment enlever les doublons d''un jeu de données ?', E'J''ai un fichier CSV de 200 000 lignes avec des phrases répétées. Quelle est la méthode la plus simple avec pandas ?', '{pandas,python,data}', now() - interval '2 days'),
  ('de000000-0000-4000-b000-000000000004', pg_temp.uid(8), 'de000000-0000-4000-9000-000000000004', 'Garder des données quand le réseau coupe, en Flutter', E'Mon application doit continuer à afficher les dernières données quand la connexion tombe. Quelle approche pour le cache local ?', '{flutter,dart,offline}', now() - interval '1 day 6 hours'),
  ('de000000-0000-4000-b000-000000000005', pg_temp.uid(6), 'de000000-0000-4000-9000-000000000001', 'Quel format d''image pour les textures d''un jeu web ?', E'PNG, WebP ou autre ? Je veux un bon équilibre entre poids et qualité pour des téléphones modestes.', '{gamedev,webgl}', now() - interval '1 day'),
  ('de000000-0000-4000-b000-000000000006', pg_temp.uid(9), null, 'Docker : à quoi sert vraiment un volume ?', E'Mon conteneur perd ses fichiers à chaque redémarrage. Je ne comprends pas où ils vont.', '{docker,devops}', now() - interval '20 hours'),
  ('de000000-0000-4000-b000-000000000007', pg_temp.uid(5), 'de000000-0000-4000-9000-000000000003', 'Différence entre flex et grid en CSS ?', E'Je vois les deux partout. Quand utiliser l''un ou l''autre ?', '{css,html}', now() - interval '10 hours'),
  ('de000000-0000-4000-b000-000000000008', pg_temp.uid(3), null, 'How do I tokenize Wolof text properly?', E'Standard tokenizers split Wolof words in odd places (apostrophes, suffixes). Is there a good approach or library?', '{nlp,python}', now() - interval '6 hours');

insert into public.answers (question_id, author_id, body, created_at) values
  ('de000000-0000-4000-b000-000000000001', pg_temp.uid(2), E'Utilise `json.load` :\n\n```python\nimport json\n\nwith open("data.json") as f:\n    data = json.load(f)\nprint(data["nom"])\n```', now() - interval '3 days' + interval '2 hours'),
  ('de000000-0000-4000-b000-000000000001', pg_temp.uid(3), 'Avec `pathlib` aussi : `Path("data.json").read_text()` puis `json.loads(...)`.', now() - interval '3 days' + interval '5 hours'),
  ('de000000-0000-4000-b000-000000000002', pg_temp.uid(1), E'Il manque le **tableau de dépendances**. Sans lui, l''effet se relance à chaque rendu :\n\n```javascript\nuseEffect(() => {\n  fetchData().then(setData)\n}, [])\n```', now() - interval '2 days' + interval '1 hour'),
  ('de000000-0000-4000-b000-000000000002', pg_temp.uid(2), 'Et si tu dépends d''une valeur, mets-la dans le tableau plutôt que de le laisser vide.', now() - interval '2 days' + interval '3 hours'),
  ('de000000-0000-4000-b000-000000000003', pg_temp.uid(2), E'Avec pandas :\n\n```python\ndf = df.drop_duplicates(subset="phrase")\n```\nTu peux aussi normaliser la casse avant.', now() - interval '2 days' + interval '4 hours'),
  ('de000000-0000-4000-b000-000000000004', pg_temp.uid(2), 'Regarde `sqflite` pour une base locale, ou `hive` pour du simple clé-valeur. Affiche d''abord le cache, puis rafraîchis en arrière-plan.', now() - interval '1 day 4 hours'),
  ('de000000-0000-4000-b000-000000000005', pg_temp.uid(1), 'WebP presque toujours : environ 30 % plus léger que le PNG à qualité égale, et accepté par tous les navigateurs récents.', now() - interval '22 hours'),
  ('de000000-0000-4000-b000-000000000005', pg_temp.uid(2), 'Pour du pixel art, garde le PNG : WebP avec perte peut flouter les bords.', now() - interval '20 hours'),
  ('de000000-0000-4000-b000-000000000006', pg_temp.uid(4), E'Un conteneur est jetable : ses fichiers disparaissent avec lui. Un **volume** est un dossier stocké hors du conteneur, qui survit.\n\n```bash\ndocker run -v donnees:/app/data mon-image\n```', now() - interval '18 hours'),
  ('de000000-0000-4000-b000-000000000007', pg_temp.uid(1), '`flex` pour aligner sur une ligne ou une colonne, `grid` quand tu as des lignes ET des colonnes à contrôler (une mise en page entière).', now() - interval '8 hours'),
  ('de000000-0000-4000-b000-000000000007', pg_temp.uid(6), 'Règle simple : un seul axe, flex. Deux axes, grid.', now() - interval '7 hours');

-- Choose a solution on four of the questions, and add a few votes.
update public.questions q set accepted_answer_id = a.id
  from public.answers a
 where a.question_id = q.id
   and ((q.id = 'de000000-0000-4000-b000-000000000001' and a.author_id = pg_temp.uid(2))
     or (q.id = 'de000000-0000-4000-b000-000000000002' and a.author_id = pg_temp.uid(1))
     or (q.id = 'de000000-0000-4000-b000-000000000005' and a.author_id = pg_temp.uid(1))
     or (q.id = 'de000000-0000-4000-b000-000000000006' and a.author_id = pg_temp.uid(4)));

insert into public.question_votes (question_id, user_id)
select q.id, pg_temp.uid(n) from public.questions q, generate_series(1, 4) n
 where q.id::text like 'de000000-0000-4000-b000-%' and q.author_id <> pg_temp.uid(n) and (ascii(right(q.id::text, 1)) + n) % 2 = 0;
insert into public.answer_votes (answer_id, user_id)
select a.id, pg_temp.uid(n) from public.answers a, generate_series(1, 6) n
 where a.question_id::text like 'de000000-0000-4000-b000-%' and a.author_id <> pg_temp.uid(n) and (a.id + n) % 3 <> 0;

-- ---------------------------------------------------------------------
-- 6 sample projects, with stars and a few comments
-- ---------------------------------------------------------------------
insert into public.projects (id, owner_id, github_owner, github_repo, title, summary, tags, is_public, github_description, language, github_stars, github_forks, github_synced_at, github_pushed_at, verified_at, created_at) values
  ('de000000-0000-4000-c000-000000000001', pg_temp.uid(2), 'jaajef-demo', 'teranga-racer', 'Teranga Racer', 'Un jeu de course sur le circuit de la Corniche de Dakar, jouable dans le navigateur.', '{gamedev,typescript,webgl}', true, 'Browser racing game set in Dakar', 'TypeScript', 186, 18, now(), now() - interval '2 hours', now() - interval '10 days', now() - interval '12 days'),
  ('de000000-0000-4000-c000-000000000002', pg_temp.uid(1), 'jaajef-demo', 'teranga-ui', 'Teranga UI', 'Des composants accessibles, inspirés des couleurs et des motifs du Sénégal.', '{react,ui,design}', true, 'Accessible React components', 'TypeScript', 248, 31, now(), now() - interval '5 hours', now() - interval '20 days', now() - interval '22 days'),
  ('de000000-0000-4000-c000-000000000003', pg_temp.uid(3), 'jaajef-demo', 'wolof-llm', 'Wolof LLM', 'Un modèle ouvert pour comprendre et écrire le wolof.', '{ia,nlp,wolof}', true, 'Open language model for Wolof', 'Python', 312, 44, now(), now() - interval '1 day', now() - interval '25 days', now() - interval '27 days'),
  ('de000000-0000-4000-c000-000000000004', pg_temp.uid(8), 'jaajef-demo', 'mbalit-pay', 'Mbalit Pay', 'Une application mobile de paiement qui fonctionne même avec un réseau lent.', '{flutter,mobile,paiement}', true, 'Offline-first payments app', 'Dart', 97, 9, now(), now() - interval '3 days', now() - interval '8 days', now() - interval '9 days'),
  ('de000000-0000-4000-c000-000000000005', pg_temp.uid(4), 'jaajef-demo', 'gardien-secrets', 'Gardien des secrets', 'Un outil en ligne de commande qui détecte les clés oubliées dans un dépôt.', '{securite,cli,go}', true, 'Detect leaked secrets in a repo', 'Go', 154, 12, now(), now() - interval '2 days', now() - interval '15 days', now() - interval '16 days'),
  ('de000000-0000-4000-c000-000000000006', pg_temp.uid(9), 'jaajef-demo', 'pipeline-simple', 'Pipeline simple', 'Un modèle de pipeline pour tester et déployer un projet en cinq minutes.', '{devops,ci,docker}', true, 'Five-minute CI/CD template', 'Shell', 63, 7, now(), now() - interval '4 days', now() - interval '6 days', now() - interval '7 days');

insert into public.project_stars (project_id, user_id)
select p.id, pg_temp.uid(n) from public.projects p, generate_series(1, 10) n
 where p.id::text like 'de000000-0000-4000-c000-%' and p.owner_id <> pg_temp.uid(n) and (ascii(right(p.id::text, 1)) + n) % 3 <> 0;

insert into public.project_comments (project_id, author_id, body, created_at) values
  ('de000000-0000-4000-c000-000000000001', pg_temp.uid(1), 'Le circuit de la Corniche est magnifique. @moussa_diop bravo !', now() - interval '3 days'),
  ('de000000-0000-4000-c000-000000000001', pg_temp.uid(8), 'Fluide même sur mon vieux téléphone.', now() - interval '2 days'),
  ('de000000-0000-4000-c000-000000000002', pg_temp.uid(2), 'J''ai remplacé mes boutons par les tiens, merci pour l''accessibilité.', now() - interval '4 days'),
  ('de000000-0000-4000-c000-000000000003', pg_temp.uid(7), 'Super jeu de données. Je peux contribuer des phrases ?', now() - interval '5 days');

-- ---------------------------------------------------------------------
-- 4 blog posts, with a few likes and comments
-- ---------------------------------------------------------------------
insert into public.blog_posts (id, author_id, slug, title, summary, body, tags, status, published_at, created_at) values
  ('de000000-0000-4000-d000-000000000001', pg_temp.uid(2), 'construire-un-jeu-de-course-dans-le-navigateur', 'Construire un jeu de course dans le navigateur', 'Ce que j''ai appris en créant Teranga Racer, de la première ligne à la démo en ligne.',
   E'## Pourquoi un jeu de course ?\n\nJe voulais un projet **visuel**, rapide à tester, et qui parle de chez nous : la Corniche de Dakar.\n\n## Trois leçons\n\n1. **Le temps entre deux images** doit piloter le mouvement, pas le nombre d''images.\n2. Un format d''image léger change tout sur un téléphone modeste.\n3. Montrer tôt, même moche, attire les bons conseils.\n\n```typescript\nplayer.position.x += speed * delta\n```\n\nMerci à la communauté GameDev Senegal.', '{gamedev,typescript}', 'published', now() - interval '6 days', now() - interval '7 days'),
  ('de000000-0000-4000-d000-000000000002', pg_temp.uid(3), 'un-modele-de-langue-pour-le-wolof', 'Un modèle de langue pour le wolof : où en est-on ?', 'Données, difficultés et prochaines étapes pour une IA qui comprend le wolof.',
   E'## Le manque de données\n\nLe wolof est parlé par des millions de personnes, mais il existe très peu de texte propre pour entraîner un modèle.\n\n## Ce qu''on a fait\n\n- Collecte de **50 000 phrases** relues par la communauté\n- Nettoyage et retrait des doublons\n- Premiers essais d''entraînement\n\n## Comment aider\n\nRelire des phrases, proposer des traductions, ou simplement partager le projet.', '{ia,nlp,wolof}', 'published', now() - interval '4 days', now() - interval '5 days'),
  ('de000000-0000-4000-d000-000000000003', pg_temp.uid(4), 'ne-publiez-jamais-vos-cles-dacces', 'Ne publiez jamais vos clés d''accès', 'Trois habitudes simples pour ne plus jamais exposer un secret dans un dépôt.',
   E'## Le problème\n\nUne clé publiée, même une minute, peut être copiée par des robots.\n\n## Trois habitudes\n\n1. Mettre les secrets dans des **variables d''environnement**.\n2. Ajouter le fichier `.env` au `.gitignore` *avant* le premier commit.\n3. Utiliser un outil qui scanne le dépôt avant chaque envoi.\n\nSi une clé a fuité : **changez-la tout de suite**, supprimer le commit ne suffit pas.', '{securite,git}', 'published', now() - interval '3 days', now() - interval '3 days'),
  ('de000000-0000-4000-d000-000000000004', pg_temp.uid(1), 'designer-avec-les-couleurs-du-senegal', 'Designer avec les couleurs du Sénégal', 'Comment un système de design peut porter une identité sans la caricaturer.',
   E'## Partir d''une palette\n\nVert, jaune, rouge : on les retrouve partout, mais utilisés tels quels ils fatiguent. Je les ai **adoucis** et gardés pour les moments importants.\n\n## Les motifs\n\nLes motifs de tissage inspirent la grille et les séparateurs, discrètement.\n\n> Une identité se sent, elle ne s''affiche pas.', '{design,ui}', 'published', now() - interval '1 day', now() - interval '2 days');

insert into public.blog_likes (post_id, user_id)
select p.id, pg_temp.uid(n) from public.blog_posts p, generate_series(1, 10) n
 where p.id::text like 'de000000-0000-4000-d000-%' and p.author_id <> pg_temp.uid(n) and (ascii(right(p.id::text, 1)) + n) % 2 = 0;

insert into public.blog_comments (post_id, author_id, body, created_at) values
  ('de000000-0000-4000-d000-000000000001', pg_temp.uid(10), 'Très clair. Je vais essayer le coup du temps entre deux images.', now() - interval '5 days'),
  ('de000000-0000-4000-d000-000000000002', pg_temp.uid(7), 'Je veux bien relire des phrases, dites-moi comment faire.', now() - interval '3 days'),
  ('de000000-0000-4000-d000-000000000003', pg_temp.uid(5), 'Merci, je viens de vérifier mes dépôts. @cheikh_sow tu as sauvé mon week-end.', now() - interval '2 days');

commit;
