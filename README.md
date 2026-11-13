# Le Magnat en ligne

Jeu de cartes du Magnat pour 4 à 6 joueurs, jouable dans le navigateur avec un simple lien.
Un petit serveur Node garde l'état de chaque table, valide tous les coups et n'envoie à chaque
joueur que sa propre main. Tes amis n'ont besoin ni de compte ni d'installation.

## Lancer sur ton ordinateur

Il faut Node 18 ou plus.

```
npm install
npm start
```

Ouvre http://localhost:3000. Pour jouer avec des gens sur le même réseau Wi-Fi, donne-leur
`http://ADRESSE-IP-DE-TON-ORDI:3000`.

## Mettre en ligne (exemple avec Render)

1. Crée un dépôt GitHub avec le contenu de ce dossier. Ne mets pas `node_modules` (le fichier
   `.gitignore` s'en charge).
2. Sur render.com, choisis **New → Web Service** et relie le dépôt.
3. Réglages : *Runtime* Node, *Build command* `npm install`, *Start command* `npm start`,
   *Instance type* Free. Le fichier `render.yaml` contient les mêmes réglages si tu préfères
   passer par un Blueprint.
4. Quand le déploiement est terminé, ouvre l'adresse `https://…onrender.com`, crée une table
   et envoie le lien à tes amis.

Avec l'offre gratuite de Render :
- le service s'arrête après 15 minutes sans trafic et met environ une minute à redémarrer.
  Les messages WebSocket comptent comme du trafic, donc il reste éveillé tant que quelqu'un joue ;
- Render peut aussi redémarrer le service à tout moment.

Les tables sont gardées en mémoire. Un arrêt ou un redémarrage du serveur efface donc les
parties en cours, et les joueurs reviennent à l'écran d'accueil avec un message.

N'importe quel hébergeur Node qui accepte les WebSocket convient (Railway, Fly.io, un petit
serveur à toi). Le serveur lit le port dans la variable `PORT`. Derrière un proxy HTTPS, le
navigateur utilise automatiquement `wss://`.

## Jouer

1. Chacun choisit un pseudo. L'un crée la table et partage le lien ou le code à 4 lettres.
2. L'hôte voit la liste des joueurs. Il peut ajouter des bots (niveau réglable), retirer un
   joueur, choisir le nombre de manches, puis lancer la partie à partir de 4 joueurs, bots compris.
3. Le tour se joue en cliquant sur les cartes, puis sur **Jouer** ou **Passer**. Les cartes
   grisées ne sont pas jouables. Face à une paire ou un brelan, un clic sélectionne le bon nombre
   de cartes.

Cas particuliers :
- **Déconnexion** : un joueur qui recharge la page ou perd sa connexion reprend sa place.
  S'il reste absent pendant son tour, un bot joue un coup à sa place au bout de 25 secondes.
- **Quitter en cours de partie** : un bot prend la place du joueur. L'hôte peut aussi quitter,
  l'hôte passe alors au joueur suivant.
- **Points** : le premier de la manche gagne autant de points que d'adversaires, le dernier zéro.
  Rôles affichés : Millionnaire, Riche, Classe moyenne, Pauvre, Misérable.
- **Échange de cartes** (dès la 2e manche) : le dernier donne ses 2 meilleures cartes au premier,
  qui lui en rend 2 de son choix. L'avant-dernier donne sa meilleure carte au deuxième, qui lui en
  rend 1 de son choix. Les meilleures cartes partent d'office. Les cartes reçues portent un point
  doré. Un bot, ou un joueur parti, rend ses cartes les moins utiles (il garde le 3 de pique).
  Un joueur absent au moment de rendre ses cartes est remplacé après 25 secondes.

## Sécurité en deux lignes

Le serveur vérifie chaque coup (tour, cartes présentes dans la main, règles) et limite le débit
des messages. Les pseudos sont nettoyés, et la page est servie avec une politique CSP stricte.
Il n'y a ni compte ni mot de passe : le code de table à 4 lettres est le seul « secret »,
donc ne le publie pas.

## Réglages (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port d'écoute |
| `MAGNAT_BOT_MS` | 900 | Délai de réflexion d'un bot, en ms |
| `MAGNAT_AFK_MS` | 25000 | Délai avant qu'un bot joue pour un joueur absent, en ms |
| `MAGNAT_RATE` | 15 | Messages par seconde acceptés par connexion |

## Tests

```
npm test
```

Le premier test vérifie les règles et joue 4500 manches de bots à 4, 5 et 6 joueurs. Le second
démarre le serveur et fait jouer de vrais clients WebSocket : salon, table pleine, coups refusés,
mains cachées, reconnexion, bot qui remplace un absent, parties complètes à 4 et à 6, et l'échange
de cartes (bons partenaires, meilleures cartes, choix libre, refus des coups invalides, absent).

## Fichiers

```
server.js          serveur HTTP + WebSocket, tables, bots
public/engine.js   règles du jeu et IA (partagé serveur / navigateur)
public/index.html  page
public/style.css   style
public/app.js      interface et connexion
test/              tests
render.yaml        réglages pour Render
```
