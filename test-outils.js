// Outils communs aux tests WebSocket de ce dépôt (test.js, test-16.js). Pas un
// test : un client qui garde TOUT ce qu'il reçoit, des attentes sur condition
// (jamais de délai fixe), et l'inspecteur de fil qui vérifie champ par champ
// qu'aucun message ne trahit la scène, un rôle, les versions ou un vote.
'use strict';
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function compteur() {
  let ok = 0, ko = 0;
  const t = (nom, cond, detail) => {
    if (cond) { ok++; console.log('OK   ' + nom); }
    else { ko++; console.log('KO   ' + nom + (detail ? ' — ' + detail : '')); }
  };
  t.bilan = () => ({ ok, ko });
  return t;
}

// Un client : il répond à la présence (sauf si on le lui interdit), garde tous
// les messages, et sait attendre le prochain qui satisfait une condition.
function client(url, nom) {
  const ws = new WebSocket(url);
  const c = { ws, nom, msgs: [], repond: true, ferme: null, lu: 0, ecouteurs: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.type === 'presence' && m.remplace !== true && c.repond) ws.send(JSON.stringify({ action: 'presence', n: m.n }));
    for (const f of c.ecouteurs) f(m);
  });
  ws.on('close', (code, why) => { c.ferme = { code, raison: String(why) }; });
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  c.wait = async (pred, ms = 5000, depuis = c.lu) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      for (let i = depuis; i < c.msgs.length; i++) if (pred(c.msgs[i])) { c.lu = i + 1; return c.msgs[i]; }
      await sleep(3);
    }
    return null;
  };
  c.suite = (pred, ms) => c.wait(pred, ms, c.msgs.length);
  c.tous = (pred) => c.msgs.filter(pred);
  c.dernier = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  c.on = (f) => c.ecouteurs.push(f);
  return c;
}

async function joindre(c, nom, code, avatar) {
  await c.open;
  const msg = { action: 'join', name: nom, avatar: avatar || { kind: 'emoji', emoji: '🔎' } };
  if (code) msg.code = code;
  c.send(msg);
  const you = await c.wait((m) => m.type === 'you' || m.type === 'error');
  if (!you || you.type === 'error') throw new Error(`${nom} : join refusé (${you && you.message})`);
  c.id = you.id;
  c.code = you.code;
  return you;
}

async function attendre(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(3); }
  return false;
}

// ----------------------------------------------------------------- robot
// Un joueur pressé : il rend la parole dès qu'il l'a (« J'ai répondu »), se
// dit prêt au débat, vote, et choisit une version s'il est démasqué. Il
// n'utilise que ce que SON client a reçu ; le TEST peut lui souffler son vote
// (`vote(phase, robot)` → id) ou son choix (`guess(options)` → index), par
// exemple d'après la vérité relevée côté serveur, pour jouer un scénario.
function robot(c, o = {}) {
  const opts = { repondre: true, pret: true, voter: true, ...o };
  let role = null;
  c.on((m) => {
    if (opts.off) return;
    if (m.type === 'role') role = m;
    else if (m.type === 'game') c.joueurs = m.identities.map((x) => x.id);
    else if (m.type === 'phase') {
      if (m.phase === 'question' && m.question.speaker === c.id && opts.repondre) {
        setTimeout(() => c.send({ action: 'answered', roundId: m.roundId }), 5);
      } else if (m.phase === 'debate' && opts.pret) {
        setTimeout(() => c.send({ action: 'ready', roundId: m.roundId }), 5);
      } else if (m.phase === 'vote' && opts.voter) {
        const presents = m.players.filter((p) => !p.left && p.id !== c.id).map((p) => p.id);
        const cible = opts.vote ? opts.vote(m, c, role) : presents[Math.floor(Math.random() * presents.length)];
        if (cible) setTimeout(() => c.send({ action: 'vote', roundId: m.roundId, target: cible }), 5);
      } else if (m.phase === 'reveal' && opts.suivant && m.reveal) {
        setTimeout(() => c.send({ action: 'next' }), opts.suivant);
      }
    } else if (m.type === 'options') {
      const choix = opts.guess ? opts.guess(m.options, c) : 0;
      setTimeout(() => c.send({ action: 'guess', roundId: m.roundId, option: choix }), 5);
    }
  });
  return c;
}

// ---------------------------------------------------------------- le fil
// Chaque type de message a ses champs, et seulement eux. Un champ de plus —
// « juste pour l'affichage » — c'est typiquement par là qu'un secret finit par
// fuiter : le test refuse tout champ inconnu.
const ETAT = ['roundId', 'rounds', 'phase', 'remainingMs', 'durationMs', 'title', 'question', 'asked', 'ready', 'voted', 'verdict', 'liar', 'reveal', 'players'];
const CHAMPS = {
  presence: ['type', 'n', 'cle', 'remplace'],
  you: ['type', 'id', 'code', 'host'],
  lobby: ['type', 'code', 'phase', 'min', 'max', 'rounds', 'flashMs', 'players'],
  game: ['type', 'code', 'you', 'host', 'rounds', 'flashMs', 'identities'],
  round: ['type', 'roundId', 'rounds', 'title', 'players'],
  role: ['type', 'roundId', 'role'],
  phase: ['type', ...ETAT],
  scene: ['type', 'roundId', 'scene'],
  options: ['type', 'roundId', 'options'],
  ready: ['type', 'roundId', 'ready'],
  voted: ['type', 'roundId', 'voted'],
  left: ['type', 'id', 'host', 'players'],
  results: ['type', 'complete', 'host', 'ranking'],
  snapshot: ['type', 'code', 'you', 'host', 'flashMs', 'identities', ...ETAT, 'role', 'scene', 'options', 'complete', 'ranking'],
  refused: ['type', 'action', 'roundId', 'reason', 'message'],
  error: ['type', 'message'],
};
const SOUS = {
  players: ['id', 'name', 'avatar', 'host', 'score', 'left'],
  identities: ['id', 'name', 'avatar', 'host'],
  ranking: ['id', 'name', 'avatar', 'rank', 'score', 'left'],
  question: ['index', 'count', 'text', 'famille', 'order', 'speaker', 'answered'],
  verdict: ['accused', 'tie', 'caught'],
  reveal: ['liar', 'scene', 'aborted', 'votes', 'verdict', 'options', 'answer', 'guess', 'points'],
  votes: ['id', 'target'],
  points: ['id', 'points'],
  scene: ['place', 'title', 'items'],
  options: ['place', 'title', 'items'],
  items: ['slot', 'zone', 'item'],
  avatar: ['kind', 'emoji', 'src'],
  role: ['roundId', 'role'],
};
// Sur les NOMS de champs : l'état interne du moteur n'a rien à faire sur le fil.
const CLES_INTERDITES = /endsat|deadline|^at$|timestamp|liartimes|random|^round$|^qi$|^si$|vraie|^lu$/i;
// Ce qui n'a le droit d'apparaître QUE dans la révélation (`reveal`), dans la
// scène d'un témoin (`scene`, au flash) ou dans les versions du Faux Témoin
// démasqué (`options`).
const SECRETS = /^(scene|items|item|options|answer|votes|target|guess|points)$/i;
const MAX_DUREE = 100000;   // un délai (≤ 90 s de débat), jamais un instant

// Rend la liste des écarts (vide = fil propre). `verite(roundId, id, n)` : ce
// que le SERVEUR savait de cette manche ({ role, liar, scene, options }) ; `n`
// compte les parties (la revanche repart à la manche 1).
function inspecterFil(c, verite) {
  const ecarts = [];
  const objet = (o, champs, ou) => { for (const k of Object.keys(o)) if (!champs.includes(k)) ecarts.push(`${ou} : champ inattendu « ${k} »`); };
  const parcourir = (o, ou, cle, secretOk) => {
    if (Array.isArray(o)) { o.forEach((x) => parcourir(x, ou, cle, secretOk)); return; }
    if (typeof o === 'number') {
      if (o > MAX_DUREE) ecarts.push(`${ou} : ${cle}=${o} ressemble à un instant`);
      return;
    }
    if (!o || typeof o !== 'object') return;
    if (SOUS[cle]) objet(o, SOUS[cle], `${ou} ${cle}`);
    for (const [k, v] of Object.entries(o)) {
      if (CLES_INTERDITES.test(k)) ecarts.push(`${ou} : champ interdit « ${k} »`);
      if (!secretOk && SECRETS.test(k)) ecarts.push(`${ou} : secret « ${k} » hors révélation`);
      // Un élément de scène : ses clés sont celles du vocabulaire du dessin.
      if (k === 'item') continue;
      parcourir(v, ou, k, secretOk || k === 'reveal');
    }
  };
  let partie = 0;
  c.msgs.forEach((m, i) => {
    const ou = `${c.nom} #${i} ${m.type}`;
    const champs = CHAMPS[m.type];
    if (!champs) { ecarts.push(`${ou} : type inconnu`); return; }
    if (m.type === 'game') partie += 1;
    objet(m, champs, ou);
    // `scene` et `options` sont leurs propres messages privés : vérifiés à part.
    const prive = m.type === 'scene' || m.type === 'options';
    for (const [k, v] of Object.entries(m)) {
      if (CLES_INTERDITES.test(k)) ecarts.push(`${ou} : champ interdit « ${k} »`);
      const ok = prive || (m.type === 'snapshot' && (k === 'scene' || k === 'options')) || k === 'reveal';
      if (!ok && SECRETS.test(k)) ecarts.push(`${ou} : secret « ${k} » hors révélation`);
      parcourir(v, ou, k, ok);
    }
    // L'identité du Faux Témoin : seulement une fois démasqué, ou à la révélation.
    if ((m.type === 'phase' || m.type === 'snapshot') && m.liar != null && m.phase !== 'guess') ecarts.push(`${ou} : Faux Témoin nommé hors dernière chance`);
    if ((m.type === 'phase' || m.type === 'snapshot') && m.reveal != null && m.phase !== 'reveal') ecarts.push(`${ou} : révélation avant l'heure`);
    if ((m.type === 'phase' || m.type === 'snapshot') && m.verdict != null && !['verdict', 'guess', 'reveal'].includes(m.phase)) ecarts.push(`${ou} : verdict avant l'heure`);
    if (!verite) return;
    const v = (rid) => verite(rid, c.id, partie);
    if (m.type === 'role') {
      const x = v(m.roundId);
      if (!x) ecarts.push(`${ou} : rôle sans vérité côté serveur`);
      else if (m.role !== (x.liar === c.id ? 'liar' : 'witness')) ecarts.push(`${ou} : rôle différent de celui du serveur`);
    }
    if (m.type === 'scene') {
      const x = v(m.roundId);
      if (!x) ecarts.push(`${ou} : scène sans vérité côté serveur`);
      else if (x.liar === c.id && m.scene !== null) ecarts.push(`${ou} : LE FAUX TÉMOIN REÇOIT LA SCÈNE`);
      else if (x.liar !== c.id && JSON.stringify(m.scene) !== JSON.stringify(x.scene)) ecarts.push(`${ou} : scène différente de celle du serveur`);
    }
    if (m.type === 'options') {
      const x = v(m.roundId);
      if (!x || x.liar !== c.id) ecarts.push(`${ou} : versions reçues par un autre que le Faux Témoin`);
      else if (JSON.stringify(m.options) !== JSON.stringify(x.options)) ecarts.push(`${ou} : versions différentes de celles du serveur`);
    }
    if (m.type === 'snapshot' && m.scene && m.phase !== 'flash') ecarts.push(`${ou} : scène hors flash`);
    if (m.type === 'snapshot' && m.options && m.phase !== 'guess') ecarts.push(`${ou} : versions hors dernière chance`);
  });
  return ecarts;
}

module.exports = { sleep, compteur, client, joindre, attendre, robot, inspecterFil };
