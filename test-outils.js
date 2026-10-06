// Outils communs aux tests WebSocket de ce dépôt (test.js, test-16.js). Pas un
// test : un client qui garde TOUT ce qu'il reçoit, des attentes sur condition
// (jamais de délai fixe), et l'inspecteur de fil qui vérifie champ par champ
// qu'aucun message ne trahit le coupable, un rôle ou un verrou.
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
// Un témoin honnête et pressé : il déclare ce qu'il a vu (son 1er puis son
// dernier attribut), puis, à la révélation 1, verrouille le premier suspect
// compatible avec son fragment ET les déclarations révélées qu'il croit (celles
// qui ne contredisent pas son fragment). Un Faux Témoin déclare faux et
// verrouille n'importe qui. Le robot n'utilise que ce que SON client a reçu.
function robot(c, o = {}) {
  const opts = { verrou: true, declarer: true, ...o };
  let role = null, kase = null;
  c.on((m) => {
    if (opts.off) return;
    if (m.type === 'case') { kase = m; role = null; }
    else if (m.type === 'role') role = m;
    else if (m.type === 'phase' && kase && m.caseId === kase.caseId) {
      if (!role) return;
      if ((m.phase === 'declare1' || m.phase === 'declare2') && opts.declarer) {
        const f = m.phase === 'declare1' ? role.fragment[0] : role.fragment[role.fragment.length - 1];
        let d = { attr: f.attr, value: f.value };
        if (role.role === 'liar') {
          const a = c.attrs.find((x) => x.id === f.attr);
          d = { attr: f.attr, value: a.values.find((v) => v !== f.value) };
        }
        setTimeout(() => c.send({ action: 'declare', caseId: m.caseId, ...d }), 5);
      }
      if (m.phase === 'declare2' && opts.verrou) {
        const mien = new Map(role.fragment.map((f) => [f.attr, f.value]));
        const croyables = m.rounds.flatMap((r) => r.declarations).filter((d) => !d.pass && (!mien.has(d.attr) || mien.get(d.attr) === d.value));
        const ok = (s) => [...mien].every(([a, v]) => s[a] === v);
        const score = (s) => croyables.filter((d) => s[d.attr] === d.value).length;
        let best = -1, choix = 0;
        kase.lineup.forEach((s, i) => { if ((role.role === 'liar' || ok(s)) && score(s) > best) { best = score(s); choix = i; } });
        setTimeout(() => c.send({ action: 'lock', caseId: m.caseId, suspect: choix }), 10);
      }
    } else if (m.type === 'game') c.attrs = m.attrs;
  });
  return c;
}

// ---------------------------------------------------------------- le fil
// Chaque type de message a ses champs, et seulement eux. Un champ de plus —
// « juste pour l'affichage » — c'est typiquement par là qu'un secret finit par
// fuiter : le test refuse tout champ inconnu.
const CHAMPS = {
  presence: ['type', 'n', 'cle', 'remplace'],
  you: ['type', 'id', 'code', 'host'],
  lobby: ['type', 'code', 'phase', 'max', 'cases', 'players'],
  game: ['type', 'code', 'you', 'host', 'cases', 'attrs', 'identities'],
  case: ['type', 'caseId', 'cases', 'phase', 'remainingMs', 'durationMs', 'liars', 'indic', 'lineup', 'declared', 'rounds', 'locked', 'players'],
  role: ['type', 'caseId', 'role', 'fragment', 'culprit'],
  phase: ['type', 'caseId', 'phase', 'remainingMs', 'durationMs', 'rounds', 'locked'],
  declared: ['type', 'caseId', 'declared'],
  locked: ['type', 'caseId', 'locked'],
  'case-end': ['type', 'caseId', 'cases', 'audit', 'rounds', 'players', 'remainingMs', 'last'],
  left: ['type', 'id', 'host', 'players'],
  results: ['type', 'complete', 'host', 'ranking'],
  snapshot: ['type', 'code', 'you', 'host', 'attrs', 'identities', 'caseId', 'cases', 'phase', 'remainingMs', 'durationMs', 'liars', 'indic',
    'lineup', 'declared', 'rounds', 'locked', 'players', 'role', 'audit', 'complete', 'ranking'],
  refused: ['type', 'action', 'caseId', 'reason', 'message'],
  error: ['type', 'message'],
};
const SOUS = {
  players: ['id', 'name', 'avatar', 'host', 'score', 'left'],
  identities: ['id', 'name', 'avatar', 'host'],
  ranking: ['id', 'name', 'avatar', 'rank', 'score', 'found', 'left'],
  rounds: ['round', 'declarations', 'summary'],
  declarations: ['id', 'attr', 'value', 'pass', 'round', 'truth'],
  liars: ['min', 'max'],
  avatar: ['kind', 'emoji', 'src'],
  attrs: ['id', 'values'],
  fragment: ['attr', 'value'],
  audit: ['culprit', 'liars', 'fragments', 'declarations', 'locks', 'points'],
  role: ['caseId', 'role', 'fragment', 'culprit'],
};
// Sur les NOMS de champs : l'état interne du moteur n'a rien à faire sur le fil.
const CLES_INTERDITES = /endsat|deadline|^at$|timestamp|witnesses|liartimes|random|indicplan|^range$|^kase$/i;
// Ce qui n'a le droit d'apparaître QUE dans l'audit (case-end, snapshot aux
// résultats) ou dans le rôle d'un joueur.
const SECRETS = /^(culprit|fragments?|truth|suspect|accuse|accusecorrect|correct|locks|liar|points)$/i;
const MAX_DUREE = 20000;

// Rend la liste des écarts (vide = fil propre). `verite(caseId, id)` : le rôle
// relevé CÔTÉ SERVEUR ({ role, fragment, culprit }) pour vérifier `role`.
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
      if (!secretOk && SECRETS.test(k)) ecarts.push(`${ou} : secret « ${k} » hors audit`);
      // Dans `summary`, les clés sont des attributs puis des valeurs : pas de sous-schéma.
      if (cle === 'summary') continue;
      parcourir(v, ou, k, secretOk || k === 'audit' || k === 'role');
    }
  };
  c.msgs.forEach((m, i) => {
    const ou = `${c.nom} #${i} ${m.type}`;
    const champs = CHAMPS[m.type];
    if (!champs) { ecarts.push(`${ou} : type inconnu`); return; }
    objet(m, champs, ou);
    const permis = m.type === 'role';
    for (const [k, v] of Object.entries(m)) {
      if (CLES_INTERDITES.test(k)) ecarts.push(`${ou} : champ interdit « ${k} »`);
      if (!permis && SECRETS.test(k)) ecarts.push(`${ou} : secret « ${k} » hors audit`);
      parcourir(v, ou, k, permis || k === 'audit' || k === 'role');
    }
    // Le rôle : celui que le serveur a tiré pour CE joueur, et rien d'autre.
    const r = m.type === 'role' ? m : m.type === 'snapshot' ? m.role : null;
    if (r && verite) {
      const v = verite(r.caseId, c.id);
      if (!v) ecarts.push(`${ou} : rôle sans vérité côté serveur`);
      else if (r.role !== v.role || JSON.stringify(r.fragment) !== JSON.stringify(v.fragment) || r.culprit !== v.culprit) ecarts.push(`${ou} : rôle différent de celui du serveur`);
      if (r.role !== 'liar' && r.culprit !== null) ecarts.push(`${ou} : un témoin reçoit le coupable`);
    }
    // Un snapshot ne porte l'audit qu'aux résultats.
    if (m.type === 'snapshot' && m.audit && m.phase !== 'results' && m.phase !== 'end') ecarts.push(`${ou} : audit hors résultats`);
    // Une déclaration avec sa vérité n'existe que dans l'audit.
    if ((m.type === 'phase' || m.type === 'case') && m.rounds.some((r) => r.declarations.some((d) => 'truth' in d))) ecarts.push(`${ou} : vérité d'une déclaration`);
  });
  return ecarts;
}

module.exports = { sleep, compteur, client, joindre, attendre, robot, inspecterFil };
