-- À coller dans Supabase → SQL Editor → New query → Run
-- Logs de connexion (obligation LCEN) : adresse IP + horodatage de
-- chaque connexion réussie, conservés 1 an (voir le nettoyage
-- automatique côté serveur dans server.js).
create table if not exists login_logs (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  ip text,
  created_at bigint not null
);

create index if not exists login_logs_user_idx on login_logs(user_id);
create index if not exists login_logs_created_idx on login_logs(created_at);
