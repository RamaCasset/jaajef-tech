# Sample data for the demo

- `demo_data.sql` adds 10 sample members, 5 starter communities with a little chat, 8 questions with answers, 6 projects and 4 blog posts. Run it in the Supabase SQL Editor. Running it again resets it to the same set.
- `demo_inbox.sql` adds sample messages to the chat inbox of every real member: 3 sample communities and a project room with unread messages, and 3 private conversations. Run it after `demo_data.sql`; running it again resets it.
- `demo_more_themes.sql` adds six more colour themes (coral, red earth, hibiscus, savanna, indigo, silver). Run it after `demo_souk.sql`.
- `demo_paths.sql` adds one sample learning path per clan (3 short placeholder lessons each). Run it after `learning_paths`; running it again resets it. `demo_data_remove.sql` does not remove it; to remove it run `delete from public.learning_paths where slug like '%-demo';`.
- `demo_souk.sql` adds the nine Souk creations of Marie's screen (3 themes that really change the app colours, 3 frames, 3 badges) and takes every other item off sale, so the shop shows exactly those nine. Run it after `demo_data.sql` and `souk_creator_on_shop`; running it again resets it.
- `demo_data_remove.sql` removes all of it. Real members and their content are never touched.

Every sample member has an e-mail ending in `@demo.jaajef.invalid` (an address that cannot exist), has no password and cannot sign in.
Each sample project points to a real public GitHub repository of the same kind (for example Teranga Racer to a browser racing game, Gardien des secrets to a secret scanner), so the GitHub link and the file list work. The titles and texts are sample ones.
Run these after all the database files, including `community_questions`, `project_counts_on_delete` and `chat_inbox`.
