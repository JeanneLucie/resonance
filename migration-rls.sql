-- À coller dans Supabase → SQL Editor → New query → Run
--
-- IMPORTANT, à vérifier AVANT de lancer cette requête : le site doit
-- utiliser la clé "service_role" (secrète) dans la variable SUPABASE_KEY
-- sur Render, pas la clé "anon" (publique). La clé service_role continue
-- de tout lire/écrire même une fois RLS activée sur ces tables (c'est
-- fait pour, elle contourne volontairement cette protection) ; la clé
-- anon, elle, se retrouverait bloquée partout, et le site s'arrêterait de
-- fonctionner (impossible de se connecter, de publier un morceau, etc.).
--
-- Pour vérifier : Supabase → Project Settings → API, compare la valeur de
-- "service_role" à celle de SUPABASE_KEY sur Render (Environment). Si
-- elles ne correspondent pas, remplace d'abord la valeur sur Render par
-- la clé service_role, avant de lancer cette requête.
--
-- Sans RLS activée, n'importe qui connaissant seulement la clé publique
-- ("anon") du projet peut lire ou écrire directement dans ces tables
-- depuis l'extérieur, en contournant entièrement server.js (et donc toute
-- vérification de compte, de mot de passe, etc.). Aucune policy n'est
-- ajoutée ci-dessous : ça ferme complètement l'accès public à ces tables,
-- ce qui convient ici puisque seul le site (via la clé service_role) doit
-- jamais y toucher directement.
alter table users enable row level security;
alter table tracks enable row level security;
alter table cgu_acceptances enable row level security;
alter table comments enable row level security;
alter table likes enable row level security;
alter table login_logs enable row level security;
alter table messages enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
alter table push_subscriptions enable row level security;
alter table reports enable row level security;
alter table webauthn_credentials enable row level security;

-- En cas de souci après coup (le site ne répond plus normalement), la
-- désactivation sur une table précise annule l'effet immédiatement :
-- alter table NOM_DE_LA_TABLE disable row level security;
