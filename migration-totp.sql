-- À coller dans Supabase → SQL Editor → New query → Run
-- Double authentification (TOTP) du compte admin : clé secrète (base32)
-- et état d'activation. Le secret n'est jamais renvoyé au client une
-- fois l'activation confirmée (voir publicUser dans server.js).
alter table users add column if not exists totp_secret text;
alter table users add column if not exists totp_enabled boolean default false;
