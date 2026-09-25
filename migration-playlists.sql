-- À coller dans Supabase → SQL Editor → New query → Run
-- Playlists privées : chacune appartient à un seul compte (fan ou artiste),
-- jamais visibles par quelqu'un d'autre que son propriétaire.
create table if not exists playlists (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  name text not null,
  created_at bigint not null
);

create table if not exists playlist_tracks (
  id bigint generated always as identity primary key,
  playlist_id bigint not null references playlists(id) on delete cascade,
  track_id bigint not null references tracks(id) on delete cascade,
  added_at bigint not null
);

-- Un morceau ne peut être ajouté qu'une fois à la même playlist.
create unique index if not exists playlist_tracks_unique
  on playlist_tracks(playlist_id, track_id);
