-- À coller dans Supabase → SQL Editor → New query → Run
-- Rend la suppression d'un commentaire réversible : au lieu d'effacer la
-- ligne, on la marque comme masquée (deleted_at) et on garde la trace de
-- qui l'a masquée (deleted_by), pour que l'administratrice puisse la
-- consulter plus tard et réactiver un commentaire si elle l'estime
-- légitime et non compromettant pour l'artiste.
alter table comments add column if not exists deleted_at bigint;
alter table comments add column if not exists deleted_by bigint references users(id);
