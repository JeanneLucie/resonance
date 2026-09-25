-- À coller dans Supabase → SQL Editor → New query → Run
-- Mot de passe oublié : jeton de réinitialisation à usage unique,
-- valable 1 heure (voir reset_token_expires, horodatage en millisecondes).
alter table users add column if not exists reset_token text;
alter table users add column if not exists reset_token_expires bigint;
