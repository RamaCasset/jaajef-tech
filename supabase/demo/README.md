# Sample data for the demo

- `demo_data.sql` adds 10 sample members, 5 starter communities with a little chat, 8 questions with answers, 6 projects and 4 blog posts. Run it in the Supabase SQL Editor. Running it again resets it to the same set.
- `demo_data_remove.sql` removes all of it. Real members and their content are never touched.

Every sample member has an e-mail ending in `@demo.jaajef.invalid` (an address that cannot exist), has no password and cannot sign in.
The sample projects point to a GitHub account that does not exist, so their GitHub links lead nowhere.
Run these after all the database files, including `community_questions` and `project_counts_on_delete`.
