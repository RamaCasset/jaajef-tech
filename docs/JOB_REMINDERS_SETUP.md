# Job offer reminders (setup)

An offer that has been live for 90 days sends its owner a notice asking them to close it. The notice comes again every 30 days while the offer stays open. The number of days is the setting `job_offer_stale_days` in the `game_config` table.

You need to do two things, once.

1. Run the file `supabase/migrations/20261119110000_offer_applicants_reminders.sql` in the Supabase SQL Editor (after the open job posting one).
2. Make the reminder run once a day. In the SQL Editor run:

```sql
select cron.schedule('job-offer-reminders', '0 9 * * *', $$select public.send_stale_offer_reminders()$$);
```

This runs it every day at 09:00 (UTC). If Supabase says `cron` does not exist, open Database, then Extensions, switch on `pg_cron`, and run it again. Running it more often does no harm: each offer gets one notice per 30 days.

To test right now, run `select public.send_stale_offer_reminders();` in the SQL Editor. It answers with how many offers are old enough.

The exact time is one of the things decided at the end (see `BEFORE_LAUNCH.md`).
