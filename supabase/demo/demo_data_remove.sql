-- jaajef.tech - Remove ALL the sample (demo) data.
--
-- Every sample member has an e-mail ending in @demo.jaajef.invalid (an address that cannot exist).
-- Deleting those members also deletes everything they own or wrote: their communities and messages,
-- questions and answers, projects, stars, comments and blog posts.
-- Real members are never touched. Safe to run more than once.

delete from auth.users where email like '%@demo.jaajef.invalid';
