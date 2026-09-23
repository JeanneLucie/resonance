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
  account_type text default 'artist',
  email_verified boolean default false,
  verification_token text,
  export_expires_at bigint,
  following_ids jsonb default '[]'::jsonb,
  created_at bigint not null
);

create table if not exists tracks (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  title text not null,
  genre text default '',
  ai_lyrics boolean default false,
  ai_music boolean default false,
  ai_vocals boolean default false,
  ai_tool text default '',
  audio_url text not null,
  cover_url text default '',
  collaborators text default '',
  genesis text default '',
  explicit boolean default false,
  spotify_url text default '',
  apple_url text default '',
  distribution jsonb,
  distribution_paid boolean default false,
  plays integer default 0,
  created_at bigint not null
);

create table if not exists reports (
  id bigint generated always as identity primary key,
  track_id bigint not null references tracks(id) on delete cascade,
  reason text not null,
  resolved boolean default false,
  created_at bigint not null
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  to_user_id bigint not null references users(id) on delete cascade,
  from_name text default '',
  from_email text not null,
  body text not null,
  read boolean default false,
  replied boolean default false,
  created_at bigint not null
);
