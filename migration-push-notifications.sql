-- À coller dans Supabase → SQL Editor → New query → Run
-- Notifications push (navigateur) : quand un compte active les notifications
-- depuis son espace, le navigateur crée un "abonnement" (une URL propre à cet
-- appareil + deux clés de chiffrement) qu'on garde ici pour pouvoir lui
-- envoyer un message plus tard, sans jamais connaître son contenu autrement
-- que via ce que Risuona lui envoie.
create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at bigint not null
);

create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);
