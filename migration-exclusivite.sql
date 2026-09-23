-- À coller dans Supabase → SQL Editor → New query → Run
alter table tracks add column if not exists exclusive boolean default false;
