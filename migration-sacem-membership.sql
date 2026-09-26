-- À coller dans Supabase → SQL Editor → New query → Run
--
-- Ajoute sur la table users deux colonnes pour la déclaration volontaire
-- « je suis membre de la SACEM » côté artiste : un simple booléen, et la
-- date (en millisecondes) à laquelle l'artiste est passé de non-membre à
-- membre — utile pour l'affichage côté Administration. Ce n'est pas un
-- suivi par morceau : la SACEM ne fonctionne pas ainsi, l'adhésion est une
-- démarche globale de l'artiste, pas titre par titre. Tant que cette
-- migration n'est pas exécutée, la case à cocher reste invisible côté
-- profil (le code retombe proprement sans cette info).
alter table users add column if not exists sacem_member boolean default false;
alter table users add column if not exists sacem_member_since bigint;
