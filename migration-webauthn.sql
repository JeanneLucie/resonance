-- À coller dans Supabase → SQL Editor → New query → Run
-- Double authentification par clé d'appareil (Face ID / Touch ID via le
-- trousseau Apple, ou toute autre "passkey"), en plus du code à 6
-- chiffres (TOTP) déjà en place. Un compte peut avoir plusieurs clés
-- enregistrées (un Mac, un iPhone...).
create table if not exists webauthn_credentials (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_type text default '',
  backed_up boolean default false,
  created_at bigint not null
);

create index if not exists webauthn_credentials_user_id_idx on webauthn_credentials(user_id);
