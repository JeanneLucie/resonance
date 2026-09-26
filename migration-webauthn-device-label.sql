-- À coller dans Supabase → SQL Editor → New query → Run
--
-- Complète la table webauthn_credentials (déjà créée par
-- migration-webauthn.sql) avec une colonne qui garde une étiquette lisible
-- de l'appareil (Mac, iPhone...), déduite du navigateur au moment de
-- l'enregistrement Face ID / Touch ID. Purement informatif, affiché dans
-- Administration à côté de la date. Tant que cette migration n'est pas
-- exécutée, la liste continue de fonctionner normalement, simplement sans
-- cette étiquette (affichage générique "Appareil").
alter table webauthn_credentials add column if not exists device_label text default '';
