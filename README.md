# Risuona

Plateforme indépendante d'hébergement, de découverte et de soutien pour
artistes musicaux — y compris ceux qui composent avec l'aide de l'IA
(Suno, Udio, AIVA, Boomy…).

Ce projet t'appartient à 100 % : c'est du code que tu héberges toi-même,
sous ton propre nom de domaine si tu le souhaites.

## Démarrage en local

```bash
npm install
cp .env.example .env   # puis remplis ADMIN_EMAIL et SESSION_SECRET
npm start
```

Ouvre `http://localhost:3000`.

## Comment fonctionne le compte administrateur

Tu es la seule à pouvoir devenir administratrice. Il n'existe **aucun
bouton, aucune case, aucune route dans l'application** qui permette à
qui que ce soit de s'attribuer ce rôle : il est décidé une seule fois,
au moment de l'inscription, en comparant l'e-mail utilisé à la valeur
de `ADMIN_EMAIL` dans le fichier `.env` de ton serveur.

Ce fichier `.env` n'est jamais envoyé au navigateur ni accessible à qui
que ce soit d'autre que toi (ou la personne qui gère l'hébergement).
Donc : inscris-toi en premier, avec l'adresse e-mail que tu as mise
dans `ADMIN_EMAIL`, et ton compte devient automatiquement admin. Tous
les autres comptes créés ensuite — par toi ou par des artistes — sont
de simples comptes "artiste", avec un espace strictement séparé : ils
ne voient jamais le lien "Administration" dans le menu, et les routes
`/api/admin/*` du serveur refusent toute requête si le compte connecté
n'a pas le rôle admin (vérifié côté serveur, jamais côté navigateur —
donc impossible à contourner en modifiant l'affichage).

Depuis l'espace administrateur, tu peux voir tous les artistes
inscrits et tous les morceaux publiés, et retirer un compte ou un
morceau si nécessaire (modération).

## La déclaration IA en trois niveaux

Chaque artiste choisit, par morceau :
- **Non, entièrement humain**
- **Assisté par IA** — l'IA est intervenue (paroles, musique, ou une
  proposition d'IA retravaillée de façon significative par un humain)
- **Généré par IA** — sans retouche humaine significative

C'est cohérent avec la façon dont le secteur distingue déjà les deux
cas : la RIAA et plusieurs labels professionnels poussent pour deux
étiquettes distinctes ("assisté" vs "entièrement généré"), et Spotify
utilise le standard de métadonnées DDEX pour transmettre cette
distinction — pas pour interdire l'un ou l'autre.

Sur le plan du droit d'auteur, ton intuition est la bonne : en France
comme aux États-Unis, ce qui compte pour la protection d'une œuvre
n'est pas l'outil utilisé mais l'intervention créative humaine. Un
morceau où l'IA propose une base mais où l'humain réécrit les paroles,
retravaille l'arrangement ou fait des choix artistiques déterminants
est traité très différemment, juridiquement, d'un morceau généré puis
publié tel quel. C'est exactement la distinction qu'on retrouve entre
"assisté" et "généré" — elle n'est donc pas qu'un affichage marketing,
elle reflète une vraie différence de statut.

## Distribution vers Spotify, Apple Music, etc.

Cette plateforme héberge et fait connaître les morceaux, mais ne
livre pas elle-même la musique aux plateformes de streaming — aucune
petite structure ne le peut directement, pas même en payant (statut
accordé par Spotify/Apple/Amazon eux-mêmes, après des années
d'activité prouvée). Le champ "outil utilisé" (Suno, Udio, etc.) sert
à la transparence et au tri interne.

Pour la diffusion réelle, Risuona se connecte à **LabelGrid** via
son API (voir `labelgrid.js` et le bouton "Distribuer vers
Spotify/Apple" sur le tableau de bord artiste) — invisible pour
l'artiste, qui ne quitte jamais Risuona. Il suffit d'activer un plan
API chez LabelGrid et de renseigner `LABELGRID_API_TOKEN` dans `.env`
pour que ça fonctionne (voir plus haut dans ce fichier).

## Aller plus loin

- **Stockage audio** : les fichiers uploadés sont actuellement stockés
  sur le disque du serveur (dossier `uploads/`), ce qui n'est pas
  garanti permanent sur le plan gratuit de Render. Pour un vrai
  lancement public, prévoir un stockage cloud dédié (Supabase
  Storage, ou S3).
- **Base de données** : les comptes et morceaux sont stockés sur
  Supabase (PostgreSQL géré), ce qui survit aux redéploiements et
  convient à un usage réel, pas seulement à des tests.
- **Hébergement** : ce code peut être déployé sur Railway, Render, un
  VPS, ou tout hébergeur Node.js.
- **Nom de domaine** : achète un domaine (ex. `resonance-tonnom.com`)
  chez un registrar comme OVH ou Gandi, puis connecte-le dans Render
  (Settings → Custom Domains) une fois prête à publier.
- **Distribution externe** : la connexion à LabelGrid (Spotify, Apple
  Music…) est prête côté code mais nécessite un compte LabelGrid actif
  et sa clé API dans `.env` pour fonctionner.
- **Recherche et filtres** : en place dans "Découvrir" (titre/artiste,
  genre, niveau d'IA), suffisant jusqu'à plusieurs centaines de
  morceaux.
