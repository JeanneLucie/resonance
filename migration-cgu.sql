-- À coller dans Supabase → SQL Editor → New query → Run
-- Versioning des CGU : un registre qui garde une trace de CHAQUE
-- acceptation (jamais écrasée), plus deux colonnes sur "users" qui
-- recopient juste la dernière, pour vérifier rapidement si un compte est
-- à jour.

-- Le registre : une ligne par acceptation, avec le nom et l'e-mail tels
-- qu'ils étaient à ce moment-là (même si le compte change de nom plus
-- tard, la preuve reste fidèle à l'instant de l'acceptation).
create table if not exists cgu_acceptances (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  version text not null,
  artist_name text not null,
  email text not null,
  account_type text not null,
  accepted_at bigint not null
);
create index if not exists cgu_acceptances_user_id_idx on cgu_acceptances(user_id);

-- Recopie de la dernière acceptation, pour un contrôle rapide côté serveur.
alter table users add column if not exists cgu_accepted_version text;
alter table users add column if not exists cgu_accepted_at bigint;
