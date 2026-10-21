/* LHM Broadcast HUD – plain JS, no build step.
 * Data: Socket.IO ('update' = raw CS2 GSI), REST (/api/match/current, /api/teams, /api/players).
 * Add ?mock=1 to the URL to preview with sample data (no CS2 needed). */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var MOCK = params.get('mock') === '1';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    gsi: null,            // latest raw GSI payload
    config: {},           // hud_config from the panel
    match: null,          // current match { left:{id,wins}, right:{id,wins}, matchType, vetos }
    teams: { left: null, right: null },
    players: {},          // steamid -> player from the database
    overview: {},         // map radar calibration
    radarSize: 300,
    hidden: false
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function vec(s) { return String(s || '0,0,0').split(',').map(function (x) { return parseFloat(x) || 0; }); }
  function validHex(c) { return /^#?[0-9a-f]{3,8}$/i.test(c || ''); }
  function hex(c) { return c.charAt(0) === '#' ? c : '#' + c; }
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function mapName(gsi) { var n = (gsi && gsi.map && gsi.map.name) || ''; return n.substring(n.lastIndexOf('/') + 1); }
  function cfg(key) { return (state.config.display_settings || {})[key]; }

  var WEAPON_NAMES = {
    ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', awp: 'AWP', aug: 'AUG', sg556: 'SG 553', famas: 'FAMAS', galilar: 'Galil',
    ssg08: 'SSG 08', g3sg1: 'G3SG1', scar20: 'SCAR-20', mac10: 'MAC-10', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5-SD', ump45: 'UMP-45',
    p90: 'P90', bizon: 'PP-Bizon', nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off', m249: 'M249', negev: 'Negev',
    glock: 'Glock', hkp2000: 'P2000', usp_silencer: 'USP-S', p250: 'P250', elite: 'Dualies', fiveseven: 'Five-SeveN', tec9: 'Tec-9',
    cz75a: 'CZ75', deagle: 'Deagle', revolver: 'R8', taser: 'Zeus', knife: 'Knife', knife_t: 'Knife', c4: 'C4'
  };
  function weaponName(w) { var k = String(w.name || '').replace('weapon_', ''); return WEAPON_NAMES[k] || k; }
  var PRIMARY = { Rifle: 1, SniperRifle: 1, Machinegun: 1, SubmachineGun: 1, Shotgun: 1 };

  function sideColor(side) { return side === 'CT' ? state.ctColor : state.tColor; }

  /* ---------- data derived from GSI ---------- */
  function playersList() {
    var all = (state.gsi && state.gsi.allplayers) || {};
    return Object.keys(all).map(function (id) { var p = all[id]; p.steamid = id; return p; });
  }

  // Which database team (left/right) is currently on which side?
  function sideMap() {
    var list = playersList();
    var left = state.teams.left, right = state.teams.right;
    var leftIds = {}, rightIds = {};
    Object.keys(state.players).forEach(function (sid) {
      var p = state.players[sid];
      if (left && p.team === left._id) leftIds[sid] = 1;
      if (right && p.team === right._id) rightIds[sid] = 1;
    });
    var l = 0, r = 0;
    list.forEach(function (p) {
      if (p.team !== 'CT') return;
      if (leftIds[p.steamid]) l++;
      if (rightIds[p.steamid]) r++;
    });
    var leftIsCT;
    if (l || r) leftIsCT = l >= r;
    else {
      leftIsCT = true;
      var m = state.match, name = mapName(state.gsi);
      if (m && m.vetos) m.vetos.forEach(function (v) { if (v.mapName === name && v.reverseSide) leftIsCT = false; });
    }
    return leftIsCT ? { left: 'CT', right: 'T' } : { left: 'T', right: 'CT' };
  }

  /* ---------- rendering ---------- */
  function avatarOf(p) {
    var db = state.players[p.steamid];
    return db && db.avatar ? db.avatar : '';
  }
  function nameOf(p) {
    var db = state.players[p.steamid];
    return (db && db.username) || p.name || '';
  }

  function renderScoreboard(sides) {
    var g = state.gsi, el = $('scoreboard');
    if (!g || !g.map) { el.innerHTML = ''; return; }
    var list = playersList();
    var m = state.match || {};
    var needPips = m.matchType && m.matchType !== 'bo1';
    var pipsTotal = needPips ? Math.ceil(Number(m.matchType.replace('bo', '')) / 2) : 0;

    function team(posn) {
      var side = sides[posn];
      var db = state.teams[posn];
      var gm = side === 'CT' ? g.map.team_ct : g.map.team_t;
      var alive = list.filter(function (p) { return p.team === side && num(p.state && p.state.health) > 0; }).length;
      var total = Math.max(5, list.filter(function (p) { return p.team === side; }).length);
      var dots = '';
      for (var i = 0; i < total; i++) dots += '<i class="' + (i < alive ? '' : 'dead') + '"></i>';
      var wins = num(m[posn] && m[posn].wins), pips = '';
      for (var j = 0; j < pipsTotal; j++) pips += '<i class="' + (j < wins ? 'win' : '') + '"></i>';
      var name = (db && db.name) || (gm && gm.name) || (side === 'CT' ? 'Counter-Terrorists' : 'Terrorists');
      return '<div class="sb-team ' + posn + '" style="--side:' + sideColor(side) + '">' +
        '<div class="sb-main"><div class="sb-logo">' + (db && db.logo ? '<img src="' + esc(db.logo) + '">' : '') + '</div>' +
        '<div class="sb-name">' + esc(name) + '</div><div class="sb-score">' + num(gm && gm.score) + '</div></div>' +
        '<div class="sb-sub"><div class="sb-alive">' + dots + '</div><div class="sb-pips">' + pips + '</div></div></div>';
    }

    var pc = g.phase_countdowns || {}, phase = pc.phase || (g.round && g.round.phase) || '';
    var ends = num(pc.phase_ends_in), timeTxt = '', cls = '', label = '';
    if (phase === 'bomb') { timeTxt = String(Math.max(0, Math.ceil(ends))); cls = 'bomb'; label = 'Bomb planted'; }
    else if (phase === 'defuse') { timeTxt = String(Math.max(0, Math.ceil(ends))); cls = 'defuse'; label = 'Defusing'; }
    else if (phase === 'freezetime') { timeTxt = fmt(ends); label = 'Freeze time'; }
    else if (phase === 'live') { timeTxt = fmt(ends); if (ends <= 10) cls = 'low'; label = ' '; }
    else if (phase === 'over') { timeTxt = '–'; label = 'Round over'; }
    else if (phase) { timeTxt = fmt(ends); label = phase.replace(/_/g, ' '); }
    var round = num(g.map.team_ct && g.map.team_ct.score) + num(g.map.team_t && g.map.team_t.score) + (phase === 'over' ? 0 : 1);

    el.innerHTML = team('left') +
      '<div class="sb-center"><div class="sb-round">Round ' + round + '</div>' +
      '<div class="sb-time ' + cls + '">' + timeTxt + '</div><div class="sb-phase">' + esc(label) + '</div></div>' +
      team('right');
  }

  function utilIcons(p) {
    var out = '';
    var w = p.weapons || {};
    Object.keys(w).forEach(function (k) {
      if (w[k].type !== 'Grenade') return;
      var n = String(w[k].name).replace('weapon_', '');
      var count = num(w[k].ammo_reserve, 0) + 1;
      for (var i = 0; i < Math.max(1, count); i++) out += '<span class="util-i u-' + n + '"></span>';
    });
    return out;
  }

  function mainWeapon(p) {
    var w = p.weapons || {}, keys = Object.keys(w), best = null;
    keys.forEach(function (k) { if (PRIMARY[w[k].type] && !best) best = w[k]; });
    if (!best) keys.forEach(function (k) { if (w[k].type === 'Pistol' && !best) best = w[k]; });
    if (!best) keys.forEach(function (k) { if (w[k].type === 'Knife' && !best) best = w[k]; });
    return best;
  }
  function activeWeapon(p) {
    var w = p.weapons || {}, a = null;
    Object.keys(w).forEach(function (k) { if (w[k].state === 'active') a = w[k]; });
    return a;
  }
  function hasC4(p) {
    var w = p.weapons || {};
    return Object.keys(w).some(function (k) { return w[k].type === 'C4'; });
  }

  function card(p, side, obsId) {
    var st = p.state || {}, ms = p.match_stats || {};
    var hp = num(st.health), alive = hp > 0;
    var photo = cfg('hide_photos') ? '' : avatarOf(p);
    var wp = mainWeapon(p);
    return '<div class="card ' + (alive ? '' : 'dead') + (p.steamid === obsId ? ' active' : '') + '" style="--side:' + sideColor(side) + '">' +
      '<div class="photo">' + (photo ? '<img src="' + esc(photo) + '">' : '<div class="sil"></div>') +
      '<div class="slot">' + num(p.observer_slot) + '</div>' +
      (alive && wp ? '<div class="wp">' + esc(weaponName(wp)) + '</div>' : '') +
      (alive ? '<div class="util">' + utilIcons(p) + '</div>' : '') +
      (alive && hasC4(p) ? '<div class="tag">BOMB</div>' : '') +
      (alive && st.defusekit ? '<div class="tag kit">KIT</div>' : '') +
      '<div class="nm">' + esc(nameOf(p)) + '</div></div>' +
      '<div class="hp"><div class="bar" style="width:' + hp + '%"></div><div class="val"><span>' + (alive ? hp : '') + '</span>' +
      '<span class="arm">' + (alive && num(st.armor) > 0 ? (st.helmet ? 'H+' : '') + num(st.armor) : '') + '</span></div></div>' +
      '<div class="st"><span>' + num(ms.kills) + ' / ' + num(ms.deaths) + '</span><span class="money">$' + num(st.money) + '</span></div></div>';
  }

  function renderCards(sides) {
    var g = state.gsi;
    var obsId = g && g.player && g.player.steamid;
    var list = playersList();
    function slotKey(p) { var s = num(p.observer_slot); return s === 0 ? 10 : s; }
    ['left', 'right'].forEach(function (posn) {
      var side = sides[posn];
      var mine = list.filter(function (p) { return p.team === side; }).sort(function (a, b) { return slotKey(a) - slotKey(b); });
      $(posn === 'left' ? 'cardsLeft' : 'cardsRight').innerHTML = mine.map(function (p) { return card(p, side, obsId); }).join('');
    });
  }

  function renderObserved(sides) {
    var el = $('observed'), g = state.gsi, p = g && g.player;
    if (!p || !p.steamid || !p.state || p.steamid === '1' || p.activity === 'menu') { el.className = ''; return; }
    var all = (g.allplayers || {})[p.steamid];
    var side = (all && all.team) || p.team;
    var st = p.state, ms = p.match_stats || {};
    var aw = activeWeapon(all || p);
    var hp = num(st.health);
    var photo = cfg('hide_photos') ? '' : avatarOf({ steamid: p.steamid });
    el.className = 'show';
    el.style.setProperty('--side', sideColor(side));
    el.innerHTML = '<div class="photo">' + (photo ? '<img src="' + esc(photo) + '">' : '') + '</div>' +
      '<div class="info"><div class="name">' + esc(nameOf({ steamid: p.steamid, name: p.name })) + '</div>' +
      '<div class="hpline"><span class="hpnum">' + hp + '</span><div class="hpbar"><i style="width:' + hp + '%"></i></div></div>' +
      '<div class="row"><span>K <b>' + num(ms.kills) + '</b></span><span>A <b>' + num(ms.assists) + '</b></span><span>D <b>' + num(ms.deaths) + '</b></span>' +
      '<span class="ammo">' + (aw && aw.ammo_clip !== undefined ? aw.ammo_clip + ' <small>/ ' + num(aw.ammo_reserve) + '</small>' : '') + '</span></div></div>';
  }

  function levelFor(entry, z) {
    if (!entry.levels) return entry;
    var hi = entry.levels[0], lo = entry.levels[1];
    return z >= hi.zMin ? hi : lo;
  }

  function renderRadar(sides) {
    var el = $('radar'), g = state.gsi, name = mapName(g);
    if (!g || !name || cfg('hide_radar')) { el.className = 'hide'; return; }
    var entry = state.overview[name];
    if (!entry) { el.className = 'hide'; return; }
    el.className = '';
    var bg = 'maps/' + name + '.png';
    if (el.dataset.map !== name) { el.style.backgroundImage = 'url(' + bg + ')'; el.dataset.map = name; }
    var S = state.radarSize;
    document.documentElement.style.setProperty('--radar', S + 'px');
    var obsId = g.player && g.player.steamid, html = '';
    function pos(p) {
      var v = vec(p.position), l = levelFor(entry, v[2]);
      return { x: (l.x + v[0] * l.ux) / 1024 * 100, y: (l.y + v[1] * l.uy) / 1024 * 100 };
    }
    playersList().forEach(function (p) {
      if (!p.position) return;
      var q = pos(p), alive = num(p.state && p.state.health) > 0;
      var f = vec(p.forward), yaw = Math.atan2(f[0], f[1]) * 180 / Math.PI;
      html += '<div class="dot ' + (p.team === 'CT' ? 'ct' : 't') + (alive ? '' : ' dead') + (p.steamid === obsId ? ' obs' : '') +
        '" style="left:' + q.x + '%;top:' + q.y + '%">' + num(p.observer_slot) +
        (alive ? '<span class="dir" style="transform:rotate(' + yaw + 'deg)"></span>' : '') + '</div>';
    });
    var b = g.bomb;
    if (b && b.position && (b.state === 'planted' || b.state === 'dropped' || b.state === 'defusing')) {
      var q2 = pos(b);
      html += '<div class="bomb ' + (b.state === 'dropped' ? '' : 'planted') + '" style="left:' + q2.x + '%;top:' + q2.y + '%"></div>';
    }
    el.innerHTML = html;
  }

  function renderChrome() {
    var g = state.gsi, name = mapName(g);
    $('mapTag').textContent = name ? 'Map: ' + name.replace('de_', '') : '';
    $('mapTag').style.display = name ? 'flex' : 'none';
    var logo = cfg('league_logo'), t = cfg('tournament_name'), s = cfg('tournament_stage');
    $('league').innerHTML = (t || s || logo)
      ? '<div class="txt"><div class="name">' + esc(t) + '</div><div class="stage">' + esc(s) + '</div></div>' + (logo ? '<img src="' + esc(logo) + '">' : '')
      : '';
  }

  function applyColors() {
    var ct = validHex(cfg('ct_color')) ? hex(cfg('ct_color')) : '#4a90d9';
    var t = validHex(cfg('t_color')) ? hex(cfg('t_color')) : '#d4a62a';
    state.ctColor = ct; state.tColor = t;
    var root = document.documentElement.style;
    root.setProperty('--ct', ct); root.setProperty('--t', t);
  }

  function render() {
    applyColors();
    var sides = sideMap();
    document.documentElement.style.setProperty('--left', sideColor(sides.left));
    document.documentElement.style.setProperty('--right', sideColor(sides.right));
    renderChrome();
    renderScoreboard(sides);
    renderCards(sides);
    renderObserved(sides);
    renderRadar(sides);
    $('stage').classList.toggle('hidden', state.hidden);
  }

  // GSI arrives very often; draw at most ~10 times per second.
  var pending = false, lastDraw = 0;
  function schedule() {
    if (pending) return;
    pending = true;
    var wait = Math.max(0, 100 - (Date.now() - lastDraw));
    setTimeout(function () { pending = false; lastDraw = Date.now(); render(); }, wait);
  }

  /* ---------- scaling ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    $('stage').style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);

  /* ---------- loading match / teams / players ---------- */
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function loadMatch() {
    return Promise.all([
      getJSON('/api/match/current').catch(function () { return null; }),
      getJSON('/api/players').catch(function () { return []; })
    ]).then(function (res) {
      state.match = res[0];
      state.players = {};
      res[1].forEach(function (p) { if (p.steamid) state.players[p.steamid] = p; });
      var side = function (k) {
        var id = state.match && state.match[k] && state.match[k].id;
        return id ? getJSON('/api/teams/' + id).catch(function () { return null; }) : Promise.resolve(null);
      };
      return Promise.all([side('left'), side('right')]);
    }).then(function (t) { state.teams = { left: t[0], right: t[1] }; schedule(); });
  }

  /* ---------- actions from the keybinds ---------- */
  function onAction(a) {
    var action = a && a.action;
    if (action === 'radarBigger') state.radarSize = Math.min(560, state.radarSize + 40);
    else if (action === 'radarSmaller') state.radarSize = Math.max(180, state.radarSize - 40);
    else if (action === 'toggleActive') state.hidden = !state.hidden;
    schedule();
  }

  /* ---------- start ---------- */
  fit();
  getJSON('maps/overview.json').then(function (o) { state.overview = o; schedule(); }).catch(function () {});

  if (MOCK) {
    var s = document.createElement('script');
    s.src = './mock.js';
    s.onload = function () { window.LHM_MOCK(state, schedule); };
    document.body.appendChild(s);
  } else if (window.io) {
    var socket = window.io();
    socket.on('connect', function () { socket.emit('started'); });
    socket.on('readyToRegister', function () { socket.emit('register', 'lhm-broadcast', false, 'cs2', 'hud'); });
    socket.on('hud_config', function (c) { state.config = c || {}; schedule(); });
    socket.on('update', function (d) { state.gsi = d; schedule(); });
    socket.on('match', loadMatch);
    socket.on('hud_action', onAction);
    loadMatch();
    setInterval(loadMatch, 30000);
  }
})();
