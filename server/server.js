/* FlyJack - the one shared fly.
 *
 * One process owns one fly and plays blackjack with it forever, at a pace people can watch.
 * Every browser that opens the page watches this same fly over a live feed (server-sent events)
 * instead of growing a fly of its own. What the fly has learned is saved to DATA_DIR, so a
 * restart or a redeploy carries on where it stopped.
 *
 *   GET /             the page (web/index.html, built by tools/build_web.py)
 *   GET /api/live     the live feed: a "fly" event first (everything the fly has learned, plus
 *                     the hand on the table now), then one "hand" event per hand
 *   GET /api/health   "ok", for the host's health check
 *
 * Run only ONE copy against one DATA_DIR: two copies would be two flies overwriting each other.
 *
 * Usage: node server/server.js        (settings: PORT, DATA_DIR, HOST)
 */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
var BJ = require('../src/blackjack.js'), FB = require('../src/flybrain.js');

var ROOT = path.join(__dirname, '..');
var PORT = +process.env.PORT || 8080;
var HOST = process.env.HOST || '0.0.0.0';
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
var STATE_FILE = path.join(DATA_DIR, 'fly.json');
var SAVE_EVERY_MS = 60000;

/* How long the page needs to act out a hand (web/casino.js and the steps in web/app.js), so the
   next hand comes when viewers have seen this one: dealing, then about 4 s for each hit-or-stand
   the fly sniffs out, then about half a second per card the dealer draws, then the payout. */
function screenTime(hand, decisions) {
  return 6000 + 4200 * decisions + 600 * Math.max(0, hand.dealer.length - 2);
}

/* ---------- the fly ---------- */
var circuit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/circuit.json'), 'utf8'));
var brain = new FB.Brain(circuit, { seed: (Math.random() * 1e9) | 0 });
var record = { bank: 0, curve: [], every: 10, recent: [] };   // the same learning record the page keeps
var current = null;      // the hand on the table now, as sent to viewers
var savedHands = -1;

function skill() { return BJ.expectedReturn(brain.policy(false)); }
function b64(u16) { return Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength).toString('base64'); }
function unb64(str) {
  var b = Buffer.from(str, 'base64'), copy = new Uint8Array(b.length);
  copy.set(b);                                         // a fresh, aligned buffer for the 16-bit view
  return new Uint16Array(copy.buffer);
}

function load() {
  var raw;
  try { raw = fs.readFileSync(STATE_FILE, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return false;
  }
  try {
    var d = JSON.parse(raw);
    if (d.edges !== brain.nEdges || !brain.importMemory({ hands: d.hands, strengths: unb64(d.strengths) })) throw new Error('it was saved from a different circuit');
    record.bank = +d.bank || 0; record.every = d.every || 10;
    record.curve = Array.isArray(d.curve) && d.curve.length ? d.curve : [];
    record.recent = Array.isArray(d.recent) ? d.recent.slice(-16) : [];
    savedHands = brain.hands;
    return true;
  } catch (e) {
    // never write over a fly we could not read: put the file aside and start a new one
    var aside = STATE_FILE + '.unreadable-' + Date.now();
    fs.renameSync(STATE_FILE, aside);
    console.error('Could not read the saved fly (' + e.message + '). Kept it as ' + aside + ' and started a new fly.');
    return false;
  }
}

function save() {
  if (brain.hands === savedHands) return;
  var mem = brain.exportMemory();
  var d = { version: 1, savedAt: new Date().toISOString(), hands: mem.hands, bank: record.bank, curve: record.curve, every: record.every,
    recent: record.recent, edges: mem.strengths.length, strengths: b64(mem.strengths) };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  var tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, STATE_FILE);                      // all or nothing: a crash mid-write leaves the last save intact
  savedHands = mem.hands;
}

/* One hand, played and learned at once. The cards come from a recorded random stream, so the
   page can deal exactly the same hand again (web/app.js, replay). */
function playHand() {
  var draws = [], rng = function () { var x = brain.rng(); draws.push(x); return x; };
  var hand = new BJ.Hand(rng), trace = [];
  while (!hand.done) {
    var d = brain.decide(hand.total, hand.soft, hand.up);
    trace.push({ hit: d.hit, pHit: d.pHit, vHit: d.vHit, vStand: d.vStand, odor: d.odor });
    hand.act(d.hit);
  }
  var surprise = trace.length ? brain.learnHand(trace, hand.reward) : null;
  brain.hands++;

  record.bank += hand.reward;
  record.recent.push(hand.reward); if (record.recent.length > 16) record.recent.shift();
  var c = record.curve, curveChanged = false;
  if (brain.hands - c[c.length - 1].h >= record.every) {
    c.push({ h: brain.hands, s: skill() }); curveChanged = true;
    if (c.length > 320) { record.curve = c.filter(function (p, i) { return i % 2 === 0 || i === c.length - 1; }); record.every *= 2; }
  }
  var rec = { hands: brain.hands, draws: draws, trace: trace, reward: hand.reward, result: hand.result, surprise: surprise, bank: record.bank };
  if (curveChanged) rec.curve = record.curve;
  return { rec: rec, ms: screenTime(hand, trace.length) };
}

/* ---------- viewers ---------- */
var viewers = new Set();
var memory = null;           // what the fly has learned, encoded once per hand for everyone who joins

function snapshot() {
  if (!memory) memory = b64(brain.exportMemory().strengths);
  return JSON.stringify({ hands: brain.hands, bank: record.bank, curve: record.curve, recent: record.recent,
    edges: brain.nEdges, strengths: memory, current: current, viewers: viewers.size });
}
function send(res, event, data) { res.write('event: ' + event + '\ndata: ' + data + '\n\n'); }

function loop() {
  var next = playHand();
  memory = null;
  next.rec.viewers = viewers.size;
  current = next.rec;
  var data = JSON.stringify(current);
  viewers.forEach(function (res) { send(res, 'hand', data); });
  setTimeout(loop, next.ms);
}

/* ---------- the page ---------- */
var page = null;
function loadPage() {
  try {
    var html = fs.readFileSync(path.join(ROOT, 'web/index.html'));
    page = { raw: html, gzip: zlib.gzipSync(html), etag: '"' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 16) + '"' };
  } catch (e) { console.error('web/index.html is missing: run python3 tools/build_web.py. The live feed still works.'); }
}

var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  if (url === '/api/live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    viewers.add(res);
    send(res, 'fly', snapshot());
    req.on('close', function () { viewers.delete(res); });
    return;
  }
  if (url === '/api/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if ((url === '/' || url === '/index.html') && page && (req.method === 'GET' || req.method === 'HEAD')) {
    var headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': page.etag, 'Vary': 'Accept-Encoding' };
    if (req.headers['if-none-match'] === page.etag) { res.writeHead(304, headers); res.end(); return; }
    var zipped = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (zipped) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : zipped ? page.gzip : page.raw);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
});

/* ---------- start ---------- */
if (!load()) record.curve = [{ h: 0, s: skill() }];
console.log(savedHands >= 0 ? 'The fly is back: ' + brain.hands + ' hands played so far.' : 'A new fly starts learning.');
loadPage();
loop();
setInterval(function () { try { save(); } catch (e) { console.error('Saving failed:', e.message); } }, SAVE_EVERY_MS);
setInterval(function () { viewers.forEach(function (res) { res.write(': still here\n\n'); }); }, 20000);   // keeps proxies from closing a quiet feed
server.listen(PORT, HOST, function () { console.log('FlyJack is live on port ' + PORT + ', saving to ' + STATE_FILE); });

function stop() {
  try { save(); console.log('Saved the fly at ' + brain.hands + ' hands.'); } catch (e) { console.error('Saving failed:', e.message); }
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
