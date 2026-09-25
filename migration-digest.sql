-- À coller dans Supabase → SQL Editor → New query → Run
-- Digest e-mail des nouvelles sorties : garde la trace du dernier envoi
-- pour chaque compte fan, pour ne pas renvoyer deux fois le même morceau.
alter table users add column if not exists last_digest_at bigint;
