-- Suivi de l'acceptation des CGU par les utilisateurs (bandeau de
-- réacceptation en cas de nouvelle version des conditions).
create table if not exists cgu_acceptances (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  version text not null,
  artist_name text not null,
  email text not null,
  account_type text not null,
  accepted_at bigint not null
);
create index if not exists cgu_acceptances_user_id_idx on cgu_acceptances(user_id);

alter table users add column if not exists cgu_accepted_version text;
alter table users add column if not exists cgu_accepted_at bigint;
