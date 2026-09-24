-- À coller dans Supabase → SQL Editor → New query → Run
-- Badge "Compte vérifié" : activé à la main par l'administratrice depuis
-- l'espace admin, pas de demande automatique ni de pièce d'identité stockée.
alter table users add column if not exists identity_verified boolean default false;
