-- Labels the sample projects as examples and credits the real repository behind each one.
-- Safe to run twice. Run it in the Supabase SQL Editor.
update public.projects
   set summary = 'Exemple (projet fictif). ' || summary || ' Dépôt public d''origine : ' || github_owner || '/' || github_repo || '.'
 where id::text like 'de000000-0000-4000-c000-%'
   and summary not like 'Exemple (projet fictif).%';
