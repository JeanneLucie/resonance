-- À coller dans Supabase → SQL Editor → New query → Run
-- Commentaires sur un morceau : nécessite un compte (pas de commentaire
-- anonyme, contrairement aux likes), pour la responsabilisation et pour
-- limiter le spam.
create table if not exists comments (
  id bigint generated always as identity primary key,
  track_id bigint not null references tracks(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  body text not null,
  created_at bigint not null
);

create index if not exists comments_track_idx on comments(track_id);
