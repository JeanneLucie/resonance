-- À coller dans Supabase → SQL Editor → New query → Run
-- Bouton "j'aime" : fonctionne pour un visiteur sans compte (identifiant
-- d'appareil, colonne device_id) comme pour un compte connecté (colonne
-- user_id) — jamais les deux à la fois sur une même ligne.
create table if not exists likes (
  id bigint generated always as identity primary key,
  track_id bigint not null references tracks(id) on delete cascade,
  user_id bigint references users(id) on delete cascade,
  device_id text,
  created_at bigint not null
);

-- Un compte ne peut aimer un morceau qu'une fois.
create unique index if not exists likes_track_user_unique
  on likes(track_id, user_id) where user_id is not null;

-- Un appareil (visiteur sans compte) ne peut aimer un morceau qu'une fois.
create unique index if not exists likes_track_device_unique
  on likes(track_id, device_id) where device_id is not null and user_id is null;
