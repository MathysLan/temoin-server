# temoin-server

Serveur arbitre de **« Faux Témoin »**, le jeu n° 3 du Game Hub du portfolio de
Mathys Langiny. Le client vit dans le dépôt du portfolio (`games/temoin/`,
GitHub Pages). Ici, il n'y a que l'arbitre : **le front est statique, le
serveur est la seule autorité.**

## Le jeu : « l'Interrogatoire »

> Tout le monde a vu la scène. Sauf un.

Pensé pour 3 à 16 amis sur Discord, en vocal, le navigateur à côté : l'écran
est l'arbitre, la parole est à l'oral, on ne tape jamais de texte. Refonte du
2026-10-06 (le premier gameplay, tapissage et déclarations, était un
prototype) ; le raisonnement et les jeux de référence vérifiés sont dans la
doc « Faux Témoin — refonte du game design ».

Une manche :

| Phase | Durée | Ce qui se passe |
|---|---|---|
| `role` | 3 s | chacun découvre son rôle : TÉMOIN ou FAUX TÉMOIN |
| `flash` | **5, 8 ou 10 s** (réglé au salon, 8 par défaut) | les témoins voient la scène ; le Faux Témoin n'a que son titre (« Un quai de gare ») |
| `question` | 8 s par réponse (+3 s pour lire la question) | l'écran pose une question ; chacun répond À VOIX HAUTE à son tour ; « J'ai répondu » passe au suivant |
| `debate` | 60 s (90 s dès 9 joueurs) | on s'accuse, on se défend ; finit quand tous sont « prêts » |
| `vote` | 20 s | un vote pour un autre joueur, modifiable ; finit quand tous ont voté |
| `verdict` | 4 s | le plus voté ; **une égalité en tête ne désigne personne** |
| `guess` | 15 s | seulement s'il est démasqué : le Faux Témoin retrouve la vraie scène parmi 4 versions |
| `reveal` | jusqu'au clic de l'hôte | la scène pour tous, qui a voté pour qui, les points |

Une partie compte 3 (défaut), 5 ou 7 manches ; le rôle tourne (chacun est
Faux Témoin à ±1 près). Aucune élimination.

### Les questions : du bluff, pas un quiz

**Une question n'a pas de bonne réponse** (`questions.js`) : « Cite une chose
que tu as vue », « Qu'y avait-il au fond ? », « Combien de personnes, à peu
près ? ». Deux vrais témoins répondent différemment en toute honnêteté, et le
Faux Témoin se cache dans ces écarts. Chacun dose sa précision : trop précis,
on souffle au Faux Témoin quoi dire (et quelle scène choisir à la dernière
chance) ; trop vague, on devient suspect. Une manche pose d'abord une question
OUVERTE (libre, impression), puis une ou deux CIBLÉES (zone, estimation,
couleur), de familles différentes, sans reposer une question dans la partie.
Le serveur ne vérifie aucune réponse orale.

### Qui répond

| Joueurs | Questions | Répondants |
|---|---|---|
| 3 à 6 | 2 | tout le monde répond aux deux, ordre retiré pour chacune |
| 7 à 16 | 3 | chacun répond à une seule (groupes égaux à 1 près : 6, 5, 5 à 16) |

Le Faux Témoin n'ouvre jamais la première question (il n'aurait rien entendu
pour se caler). Un joueur parti est sauté.

### Le barème (calculé ici, nulle part ailleurs)

| Fin de manche | Points |
|---|---|
| Faux Témoin pas démasqué (témoin accusé, égalité en tête, aucun vote) | **+3** pour lui |
| Démasqué, mais il retrouve la vraie scène | **+2** pour lui |
| Démasqué, et il se trompe (ou ne choisit pas) | **+1** pour chaque témoin qui a voté contre lui |
| Le Faux Témoin est parti avant la révélation | manche annulée, aucun point |

### Les scènes

`scenes.js` : 6 lieux (gare, terrasse, parc, supérette, plage, arrêt de bus),
8 emplacements chacun (`fond`, `gauche`, `centre`, `droite`, `premier`), une
variante tirée par emplacement. Le vocabulaire du dessin est FERMÉ (`KINDS` :
`ciel`, `personne`, `enfant`, `chien`, `velo`, `affiche`…) : le client dessine
la description, rien d'autre. Garanties testées sur des milliers de tirages :
au moins 2 personnages, les zones nommées par les questions jamais toutes
vides, et pour la dernière chance 4 versions du même lieu toutes différentes,
chaque leurre changeant exactement 3 emplacements.

## Ce qui est du ressort du serveur (et pas du client)

La scène et le rôle **sont** le jeu.

- **Le rôle part joueur par joueur** (`role { roundId, role }`, même forme
  pour tous).
- **La scène part joueur par joueur, au flash seulement** (`scene`) : aux
  témoins la scène, au Faux Témoin `scene: null`, même message. Le titre est
  public (`round`, `phase`). Un `snapshot` ne rend la scène que pendant le
  flash.
- **Les 4 versions** ne partent qu'au Faux Témoin démasqué (`options`),
  pendant la dernière chance ; à tous à la révélation.
- **Les votes restent secrets** jusqu'à la révélation : on diffuse QUI a voté
  (`voted`), jamais pour qui. Le Faux Témoin vote, se dit prêt et rend la
  parole comme les autres : son absence dans un compteur le trahirait.
- Aucun horodatage ni échéance absolue sur le fil : seulement `remainingMs`.

`test.js` et `test-16.js` relisent **tout le fil** de chaque client : champs
connus seulement, aucun secret (`scene`, `options`, `votes`, `points`…) hors de
la révélation, et chaque `role`, `scene` et `options` comparé à la vérité
relevée côté serveur (le Faux Témoin qui recevrait la scène est attrapé).

## Les fichiers

- `engine.js` — **le moteur pur** : rôles, tours de parole, débat, votes,
  verdict, dernière chance, barème, départs, classement. Horloge et hasard
  injectés, aucun réseau.
- `scenes.js` — les lieux, le vocabulaire du dessin, le tirage d'une scène et
  des 4 versions.
- `questions.js` — les questions et leur tirage.
- `server.js` — l'orchestre : rooms, joueurs, minuterie unique posée sur
  `nextDeadline()`, traduction des événements du moteur en messages.
- `avatar.js`, `presence.js` — copiés tels quels des autres serveurs (on les
  copie, on ne les adapte pas).

## Lancer en local

    npm install
    npm start          # écoute sur $PORT, 8096 par défaut ; GET / → « temoin-server ok »
    npm test           # avatar, moteur, parties WebSocket à 3, 4, 5, puis à 16

Les tests raccourcissent les durées par `TEST_ROLE_MS`, `TEST_FLASH_MS`,
`TEST_ASK_MS`, `TEST_ANSWER_MS`, `TEST_DEBATE_MS`, `TEST_VOTE_MS`,
`TEST_VERDICT_MS`, `TEST_GUESS_MS` (personne ne les pose en production ; la
durée du flash se règle au salon).

## Le protocole

Un seul WebSocket, du JSON. Client → serveur : `{ action, … }` ; serveur →
client : `{ type, … }`. Les `presence` sont ceux de `presence.js`.

| Client → serveur | |
|---|---|
| `join { name, avatar, code? }` | sans code : crée une room (on en est l'hôte) |
| `settings { rounds?, flashMs? }` | hôte, au salon : 3, 5 ou 7 manches ; flash 5000, 8000 ou 10000 |
| `start { rounds?, flashMs? }` | hôte, au salon ou à la fin (revanche) ; 3 joueurs au moins |
| `lobby` | hôte, à la fin : retour au salon |
| `answered { roundId }` | celui qui a la parole la rend |
| `ready { roundId, ready? }` | au débat ; `ready: false` pour se raviser |
| `vote { roundId, target }` | au vote : l'id d'un autre joueur présent ; modifiable |
| `guess { roundId, option }` | le Faux Témoin démasqué : index 0 à 3 dans `options` |
| `next` | hôte, à la révélation : manche suivante (ou fin) |
| `snapshot` | l'état complet, pour soi |
| `resume` | **refusé en V1** (pas de reprise en pleine partie) |

| Serveur → client | à qui |
|---|---|
| `you { id, code, host }` | soi |
| `lobby { code, phase, min, max, rounds, flashMs, players }` | tous |
| `game { code, you, host, rounds, flashMs, identities }` | chacun, au lancement |
| `round { roundId, rounds, title, players }` | tous, au début de chaque manche |
| `role { roundId, role }` | **soi seul** : `witness` ou `liar` |
| `phase { roundId, rounds, phase, remainingMs, durationMs, title, question, asked, ready, voted, verdict, liar, reveal, players }` | tous, à chaque phase et à chaque tour de parole : l'état public complet |
| `scene { roundId, scene }` | **soi seul**, au flash : la scène, ou `null` pour le Faux Témoin |
| `options { roundId, options }` | **le Faux Témoin démasqué seul** : les 4 versions |
| `ready { roundId, ready }` | tous : les ids prêts |
| `voted { roundId, voted }` | tous : les ids qui ont voté |
| `left { id, host, players }` | tous |
| `results { complete, host, ranking }` | tous, à la fin : rang de compétition (ex æquo = même rang) ; `complete: false` si la partie s'est arrêtée faute de joueurs |
| `refused { action, roundId, reason, message }` | soi : `NOT_YOUR_TURN`, `NOT_DEBATING`, `NOT_VOTING`, `BAD_TARGET`, `NOT_GUESSING`, `NOT_LIAR`, `BAD_OPTION`, `ALREADY_GUESSED`, `NOT_REVEAL`, `STALE_ROUND`, `NOT_IN_GAME`, `NOT_PLAYING`, `TOO_FAST` |
| `error { message }` | soi |

Dans `phase` :
- `question` (phase `question` seulement) : `{ index, count, text, famille, order, speaker, answered }` ;
- `asked` : les textes des questions déjà posées (pour le débat) ;
- `verdict` (dès le verdict) : `{ accused, tie, caught }` ;
- `liar` : l'id du Faux Témoin, pendant sa dernière chance seulement ;
- `reveal` (révélation seulement) : `{ liar, scene, aborted, votes: [{ id, target }], verdict, options, answer, guess, points: [{ id, points }] }`.

Une scène : `{ place, title, items: [{ slot, zone, item }] }`, `item` étant
`null` (emplacement vide) ou `{ kind, …attributs }` du vocabulaire `KINDS`.

## Départs

Pas de reprise en V1 : un joueur qui perd sa connexion est parti. Celui qui
avait la parole est sauté ; ses votes, et les votes contre lui, ne comptent
plus ; il ne bloque plus les fins anticipées ; l'hôte est réélu. Si le Faux
Témoin part avant la révélation, la manche s'arrête sans points (tout est
révélé). Sous 3 présents, la partie s'arrête (`results` avec
`complete: false`, aucun classement pour le Hub). Un onglet figé est fermé par
`presence.js` (4000), puis traité comme un départ.

## Déploiement

`render.yaml` décrit le service (Node, plan gratuit), déployé par Mathys sur
`wss://temoin-server.onrender.com` (redéploiement à chaque push sur `main`).
⚠️ Ce protocole remplace celui du prototype : la page `games/temoin/` du
portfolio doit suivre (serveur d'abord, front ensuite).

## Licence

MIT.
