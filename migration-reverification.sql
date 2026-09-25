-- À coller dans Supabase → SQL Editor → New query → Run
-- Renvoi automatique de vérification après une validation manuelle admin :
-- la validation manuelle (manual-verify) débloque tout de suite le compte,
-- mais on garde une trace de si l'adresse a *vraiment* été confirmée par
-- le lien (preuve utile en cas de litige : CGU, vol de morceau).
alter table users add column if not exists verified_via_link boolean default false;
alter table users add column if not exists manual_verified_at bigint;
alter table users add column if not exists reverify_email_sent_at bigint;
