-- jaajef.tech - SAMPLE job offers and applications for the demo.
-- Run it after demo_data.sql and the open job posting file. Running it again resets it.
-- Offers are posted by sample members; applications come from other sample members.
-- demo_data_remove.sql removes all of it (it removes the sample members, and this follows them).

begin;

delete from public.job_applications where applicant_id in (
  select id from auth.users where email like '%@demo.jaajef.invalid');
delete from public.employers where owner_id in (
  select id from auth.users where email like '%@demo.jaajef.invalid');

create function pg_temp.uid(n int) returns uuid language sql immutable as
$$ select ('de000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- One hidden poster record per sample member who posts.
insert into public.employers (owner_id, kind, name, description, location, status)
select pg_temp.uid(v.n), v.kind, v.name, v.descr, v.loc, 'approved'
  from (values
    (2, 'company', 'Teranga Studio', 'Studio de jeux web basé à Dakar.', 'Dakar'),
    (3, 'company', 'Wolof Labs', 'Données et langues africaines.', 'Thiès'),
    (4, 'company', 'Baobab Sécurité', 'Audit et protection des applications.', 'Saint-Louis'),
    (1, 'individual', 'Awa Diallo', null, 'Dakar'),
    (9, 'individual', 'Sokhna Gueye', null, 'Dakar')
  ) as v(n, kind, name, descr, loc);

create function pg_temp.oid(n int) returns uuid language sql immutable as
$$ select ('de100000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

insert into public.job_offers (id, employer_id, posted_by, title, kind, description, employment_type, location, remote,
                               pay_min_fcfa, pay_max_fcfa, pay_unit, pay_negotiable, tags, status, published_at, created_at)
select pg_temp.oid(v.n), e.id, e.owner_id, v.title, v.kind, v.descr, v.etype, v.loc, v.remote,
       v.pmin, v.pmax, v.punit, v.nego, v.tags, v.status,
       case when v.status in ('published', 'closed') then now() - make_interval(days => v.days) end,
       now() - make_interval(days => v.days)
  from (values
    (1, 2, 'Développeur·se front-end React', 'job', 'Nous construisons des jeux web légers pour mobile. Vous travaillez avec nos designers sur l''interface, les animations et les performances sur petite connexion.', 'full_time', 'Dakar', 'hybrid', 350000, 500000, 'month', false, array['react','typescript'], 'published', 6),
    (2, 2, 'Illustrations pour un jeu de cartes', 'freelance', 'Une série de 24 cartes illustrées aux couleurs du Sénégal. Style libre, livraison en 3 semaines.', null, null, 'remote', 150000, 250000, 'project', true, array['design','illustration'], 'published', 3),
    (3, 3, 'Data scientist junior (langues)', 'job', 'Vous aidez à construire des jeux de données en wolof et à entraîner de petits modèles. Python, pandas, et de la curiosité pour la langue.', 'full_time', 'Thiès', 'onsite', 300000, 400000, 'month', true, array['python','nlp'], 'published', 12),
    (4, 3, 'Nettoyage d''un jeu de données', 'freelance', 'Un fichier de 40 000 lignes à nettoyer et documenter. Mission courte, environ une semaine.', null, null, 'remote', 80000, 120000, 'project', false, array['python','data'], 'published', 2),
    (5, 4, 'Ingénieur·e DevOps', 'job', 'Pipelines, conteneurs et surveillance pour une dizaine de clients. Astreintes rares et bien préparées.', 'full_time', 'Saint-Louis', 'hybrid', 450000, 650000, 'month', false, array['docker','ci','linux'], 'published', 20),
    (6, 4, 'Audit de sécurité d''un site de boutique', 'freelance', 'Test des mots de passe, des formulaires et des droits d''accès d''un site e-commerce. Rapport en français.', null, null, 'remote', 200000, 300000, 'project', true, array['security','web'], 'published', 8),
    (7, 1, 'Logo et charte pour une coopérative', 'freelance', 'Une coopérative de transformation de fruits à Kaolack cherche un logo et trois couleurs.', null, null, 'remote', 100000, 150000, 'project', true, array['design','logo'], 'published', 5),
    (8, 9, 'Stage : automatisation des déploiements', 'job', 'Six mois pour apprendre les pipelines avec une équipe patiente. Bases de Linux demandées.', 'internship', 'Dakar', 'onsite', 75000, 100000, 'month', false, array['devops','python'], 'published', 1),
    (9, 9, 'Support technique', 'job', 'Brouillon : à compléter.', 'part_time', 'Dakar', 'hybrid', null, null, null, true, array['support'], 'draft', 0),
    (10, 3, 'Traduction d''une interface en wolof', 'freelance', 'Mission terminée, l''offre est fermée.', null, null, 'remote', 120000, 120000, 'project', false, array['wolof','translation'], 'closed', 40)
  ) as v(n, owner_n, title, kind, descr, etype, loc, remote, pmin, pmax, punit, nego, tags, status, days)
  join public.employers e on e.owner_id = pg_temp.uid(v.owner_n);

-- Applications from other sample members. Statuses: submitted, seen, shortlisted (shown as "Entretien"), declined.
insert into public.job_applications (offer_id, applicant_id, offer_title, employer_name, message, profile_snapshot, status, declined_at, created_at)
select pg_temp.oid(v.offer_n), pg_temp.uid(v.applicant_n), o.title, e.name, v.msg,
       jsonb_build_object('display_name', p.display_name, 'bio', p.bio, 'location', p.location, 'clan', p.clan::text),
       v.status, case when v.status = 'declined' then now() - make_interval(days => v.days - 1) end,
       now() - make_interval(days => v.days)
  from (values
    (1, 8, 'Bonjour, je fais du mobile avec Flutter et je veux passer au web. Voici mes projets sur mon profil.', 'shortlisted', 4),
    (1, 5, 'Étudiante en informatique, je cherche ma première expérience.', 'submitted', 2),
    (1, 10, 'Je contribue à un projet open source en React.', 'seen', 3),
    (2, 6, 'Je dessine depuis dix ans, mon portfolio est sur mon profil.', 'shortlisted', 2),
    (2, 1, 'Intéressée, disponible dès la semaine prochaine.', 'submitted', 1),
    (3, 7, 'Je me forme à l''analyse de données et je parle wolof à la maison.', 'submitted', 9),
    (3, 5, 'Python et pandas en cours d''apprentissage.', 'declined', 10),
    (5, 9, 'DevOps depuis trois ans, conteneurs et pipelines.', 'shortlisted', 15),
    (5, 2, 'Je cherche un poste plus proche de l''infrastructure.', 'seen', 14),
    (6, 9, 'J''ai déjà fait deux audits de boutiques en ligne.', 'submitted', 5),
    (7, 6, 'La charte graphique est mon domaine, je peux montrer des exemples.', 'submitted', 3),
    (8, 10, 'Je débute mais je suis très motivé.', 'submitted', 1),
    (8, 5, 'Les bases de Linux, je les ai apprises en quête.', 'seen', 1),
    (10, 7, 'Traduction fr-wolof, travail terminé avec succès.', 'seen', 35)
  ) as v(offer_n, applicant_n, msg, status, days)
  join public.job_offers o on o.id = pg_temp.oid(v.offer_n)
  join public.employers e on e.id = o.employer_id
  join public.profiles p on p.id = pg_temp.uid(v.applicant_n);

update public.job_applications set offer_closed_at = now() - interval '35 days'
 where offer_id = pg_temp.oid(10);

commit;
