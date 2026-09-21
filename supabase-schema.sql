-- À coller dans Supabase → SQL Editor → New query → Run
-- Crée les deux tables dont Résonance a besoin.

create table if not exists users (
  id bigint generated always as identity primary key,
  artist_name text not null,
  email text not null unique,
  password_hash text not null,
  bio text default '',
  donation_link text default '',
  spotify_url text default '',
  apple_url text default '',
  soundcloud_url text default '',
  instagram_url text default '',
  suno_url text default '',
  avatar_url text default '',
  banner_url text default '',
  role text default 'artist',
  following_ids jsonb default '[]'::jsonb,
  created_at bigint not null
);

create table if not exists tracks (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  title text not null,
  genre text default '',
  ai_level text default 'none',
  ai_tool text default '',
  audio_url text not null,
  cover_url text default '',
  collaborators text default '',
  genesis text default '',
  distribution jsonb,
  created_at bigint not null
);
