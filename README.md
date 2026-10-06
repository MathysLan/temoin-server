# temoin-server

Serveur arbitre de **« Faux Témoin »**, le jeu n° 3 du Game Hub du portfolio de
Mathys Langiny. Le client vivra dans le dépôt du portfolio (`games/temoin/`,
GitHub Pages). Ici, il n'y a que l'arbitre : **le front est statique, le
serveur est la seule autorité.**

## Le jeu

> Tout le monde a vu un bout du coupable. Quelqu'un ment sur le reste.

Un **tapissage** de suspects dessinés par attributs (chapeau, manteau, visage,
objet, carrure). Chaque témoin voit en **flash** (3 s) un ou deux attributs du
vrai coupable ; le **Faux Témoin** l'a vu en entier, et ment.

1. **Flash** (3 s) : chacun voit son fragment.
2. **Déclaration 1** (15 s) : chacun annonce une paire attribut / valeur, ou se
   tait. Ramassées en silence ; la phase finit dès que tout le monde a déclaré.
3. **Déclaration 2** (15 s) : la révélation 1 s'affiche d'un bloc (avec son
   décompte), on déclare une seconde fois, et le **verrou** s'ouvre : un bon
   verrou ici vaut **5**.
4. **Délibération** (12 s) : révélation 2 ; un bon verrou vaut **3**.
5. **Dernier appel** (8 s) : un bon verrou vaut **1**.
6. **Résultats** (9 s) : le coupable, le(s) Faux Témoin(s), et **l'audit** —
   chaque déclaration marquée vraie ou fausse, chaque verrou.

Une affaire dure environ une minute ; une partie en compte 3, 5 (défaut) ou 7.
Dès que tous les présents ont verrouillé, on passe aux résultats.

### Le barème (calculé ici, nulle part ailleurs)

| Situation | Points |
|---|---|
| Témoin, bon verrou en déclaration 2 / délibération / dernier appel | 5 / 3 / 1 |
| Désigner un Faux Témoin avec son verrou (facultatif) | +2 si juste |
| Témoin dont une déclaration était **fausse** (mensonge ou trou de mémoire) | affaire à 0 |
| Faux Témoin | `round(5 × part des témoins trompés)`, +2 si moins d'un tiers des témoins l'ont désigné, **plafonné à 7** |

Le plafond du Faux Témoin est le maximum d'un témoin parfait (5 + 2) : tirer ce
rôle n'avantage personne. Tout le monde peut mentir, mais seul le Faux Témoin y
gagne. Un témoin sans verrou est compté comme trompé ; un témoin parti sans
verrou ne compte plus.

### Selon le nombre de joueurs

| Joueurs | Suspects | Faux Témoins | Attributs vus par témoin |
|---|---|---|---|
| 2 | 12 | aucun : **l'indic** (le serveur) déclare à chaque révélation, une fois vrai, une fois faux | 2 |
| 3–5 | 12 | 1 dans 75 % des affaires (« y en a-t-il un ? » fait partie du jeu) | 2 si ≤ 3 témoins, sinon 1 |
| 6–9 | 16 | 1 | 1 |
| 10–14 | 20 (16 à 10) | 2 | 1 |
| 15–16 | 20 | 3 | 1 |

Les Faux Témoins s'ignorent entre eux. Le rôle tourne : chacun l'est à ±1 près
sur la partie. Aucune élimination.

### Le tapissage

Généré à chaque affaire (`genererTapissage`), avec quatre garanties testées sur
5 000 tirages : suspects tous différents ; les attributs vus par les témoins,
mis ensemble, n'isolent **que** le coupable ; aucun attribut seul ne suffit
(chaque valeur vue du coupable est portée par au moins 3 suspects) ; pour chaque
attribut vu, un **leurre** ne diffère du coupable que par lui (un mensonge
désigne donc quelqu'un de crédible). Les fragments sont distribués en
tourniquet : à 16, chaque attribut est vu par 2 ou 3 témoins, et un mensonge
est contredit.

## Ce qui est du ressort du serveur (et pas du client)

Le coupable et les rôles **sont** le jeu.

- **Le rôle part joueur par joueur** (`role`), avec la même forme pour tous :
  un témoin reçoit son fragment et `culprit: null`, le Faux Témoin le coupable
  entier et son index. Aucun message diffusé ne porte le coupable avant
  `case-end`.
- **Les déclarations sont ramassées en silence** : pendant la phase, on
  diffuse QUI a déclaré, jamais quoi ; tout est révélé d'un bloc.
- **Les verrous restent secrets** jusqu'à `case-end` : on diffuse leur nombre,
  rien d'autre.
- **Le Faux Témoin déclare, verrouille et accuse comme les autres** (sans
  effet sur les points) : sinon son absence dans les compteurs le trahirait.
- Aucun horodatage ni échéance absolue sur le fil : seulement `remainingMs`.

`test.js` et `test-16.js` relisent **tout le fil** de chaque client : champs
connus seulement, aucun secret (`culprit`, `fragment`, `suspect`, `accuse`,
`truth`…) hors de l'audit ou de son propre rôle, et chaque `role` comparé à
celui tiré par le serveur.

## Les fichiers

- `engine.js` — **le moteur pur** : tapissage, rôles, fragments, phases,
  déclarations, verrous, barème, audit, départs, classement. Horloge et hasard
  injectés, aucun réseau.
- `server.js` — l'orchestre : rooms, joueurs, minuterie unique posée sur
  `nextDeadline()`, traduction des événements du moteur en messages.
- `avatar.js`, `presence.js` — copiés tels quels des autres serveurs (on les
  copie, on ne les adapte pas).

## Lancer en local

    npm install
    npm start          # écoute sur $PORT, 8096 par défaut ; GET / → « temoin-server ok »
    npm test           # avatar, moteur, partie WebSocket, partie à 16

Les tests raccourcissent les durées par `TEST_FLASH_MS`, `TEST_DECLARE_MS`,
`TEST_DELIBERATE_MS`, `TEST_LASTCALL_MS`, `TEST_RESULTS_MS` (personne ne les
pose en production).

## Le protocole

Un seul WebSocket, du JSON. Client → serveur : `{ action, … }` ; serveur →
client : `{ type, … }`. Les `presence` sont ceux de `presence.js`.

| Client → serveur | |
|---|---|
| `join { name, avatar, code? }` | sans code : crée une room (on en est l'hôte) |
| `cases { cases }` | hôte, au salon : 3, 5 ou 7 affaires |
| `start { cases? }` | hôte, au salon ou à la fin (revanche) |
| `lobby` | hôte, à la fin : retour au salon |
| `declare { caseId, attr, value }` ou `{ caseId, pass: true }` | une par tour, en déclaration 1 et 2 |
| `lock { caseId, suspect, accuse? }` | définitif ; `suspect` = index dans `lineup`, `accuse` = id d'un joueur |
| `next` | hôte, aux résultats : affaire suivante sans attendre |
| `snapshot` | l'état complet, pour soi |
| `resume` | **refusé en V1** (pas de reprise en pleine partie) |

| Serveur → client | à qui |
|---|---|
| `you { id, code, host }` | soi |
| `lobby { code, phase, max, cases, players }` | tous |
| `game { code, you, host, cases, attrs, identities }` | chacun, au lancement : le vocabulaire et les identités, une fois |
| `case { caseId, cases, phase, remainingMs, durationMs, liars: {min, max}, indic, lineup, declared, rounds, locked, players }` | tous, au début de chaque affaire |
| `role { caseId, role, fragment, culprit }` | **soi seul** |
| `phase { caseId, phase, remainingMs, durationMs, rounds, locked }` | tous ; `rounds` = les tours révélés, avec leur `summary` |
| `declared { caseId, declared }` | tous : les ids qui ont déclaré ce tour |
| `locked { caseId, locked }` | tous : le nombre de verrous |
| `case-end { caseId, cases, audit, rounds, players, remainingMs, last }` | tous : l'audit (`culprit`, `liars`, `fragments`, `declarations` avec `truth`, `locks`, `points`) |
| `left { id, host, players }` | tous |
| `results { complete, host, ranking }` | tous, à la fin : rang de compétition (ex æquo = même rang) ; `complete: false` si la partie s'est arrêtée faute de joueurs |
| `refused { action, caseId, reason, message }` | soi : `NOT_DECLARING`, `ALREADY_DECLARED`, `BAD_DECLARATION`, `NOT_LOCKING`, `ALREADY_LOCKED`, `BAD_SUSPECT`, `BAD_ACCUSE`, `STALE_CASE`, `NOT_IN_GAME`, `NOT_PLAYING`, `TOO_FAST` |
| `error { message }` | soi |

Le vocabulaire (`attrs`) :

| Attribut | Valeurs |
|---|---|
| `chapeau` | `aucun`, `melon`, `casquette`, `bonnet`, `haut-de-forme` |
| `manteau` | `rouge`, `bleu`, `vert`, `jaune`, `violet` |
| `visage` | `rien`, `lunettes`, `moustache`, `barbe`, `cache-oeil` |
| `objet` | `rien`, `parapluie`, `valise`, `journal`, `canne` |
| `carrure` | `mince`, `moyenne`, `costaud` |

Les libellés affichés et le dessin sont l'affaire du client.

## Départs

Pas de reprise en V1 : un joueur qui perd sa connexion est parti. Ses
déclarations et son verrou restent ; il ne bloque plus les fins anticipées ;
l'hôte est réélu. Sous 2 présents, la partie s'arrête (`results` avec
`complete: false`, aucun classement pour le Hub). Un onglet figé est fermé par
`presence.js` (4000), puis traité comme un départ.

## Déploiement

`render.yaml` décrit le service (Node, plan gratuit). **Pas encore déployé.**

## Licence

MIT.
