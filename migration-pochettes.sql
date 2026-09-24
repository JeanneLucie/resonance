-- À coller dans Supabase → SQL Editor → New query → Run
-- Pochettes créées automatiquement : on note si la pochette d'un morceau a
-- été générée par le site (pour pouvoir la régénérer sans jamais écraser une
-- vraie image), et le choix de l'artiste pour son nom sur ces pochettes.
alter table tracks add column if not exists cover_generated boolean default false;
alter table users add column if not exists cover_name_style text default 'full';
