# Sample data for the demo

- `demo_data.sql` adds 10 sample members, 5 starter communities with a little chat, 8 questions with answers, 6 projects and 4 blog posts. Run it in the Supabase SQL Editor. Running it again resets it to the same set.
- `demo_inbox.sql` adds sample messages to the chat inbox of every real member: 3 sample communities and a project room with unread messages, and 3 private conversations. Run it after `demo_data.sql`; running it again resets it.
- `demo_data_remove.sql` removes all of it. Real members and their content are never touched.

Every sample member has an e-mail ending in `@demo.jaajef.invalid` (an address that cannot exist), has no password and cannot sign in.
Each sample project points to a real public GitHub repository of the same kind (for example Teranga Racer to a browser racing game, Gardien des secrets to a secret scanner), so the GitHub link and the file list work. The titles and texts are sample ones.
Run these after all the database files, including `community_questions`, `project_counts_on_delete` and `chat_inbox`.
