-- À coller dans Supabase → SQL Editor → New query → Run
--
-- Historique complet des changements de type de compte (artiste ↔
-- auditeur) : chaque bascule est enregistrée avec sa date, pas seulement
-- la dernière. Utile par exemple pour un compte créé artiste par erreur
-- avant que la distinction artiste/auditeur n'existe sur Risuona, corrigé
-- ensuite, ou pour un artiste qui redevient auditeur puis change encore
-- d'avis plus tard : l'administration garde la trace de chaque période.
-- Tant que cette migration n'est pas exécutée, les boutons de changement
-- de type de compte continuent de fonctionner normalement, simplement
-- sans historique affiché côté administration.
create table if not exists account_type_history (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  from_type text,
  to_type text not null,
  changed_at bigint not null
);

create index if not exists account_type_history_user_idx on account_type_history(user_id);
