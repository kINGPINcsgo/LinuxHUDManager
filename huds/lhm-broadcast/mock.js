/* Sample data for previewing the HUD without CS2: open index.html?mock=1 */
window.LHM_MOCK = function (state, schedule) {
  function svg(txt, a, b) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>' +
      '<rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="78" r="34" fill="rgba(255,255,255,.55)"/>' +
      '<ellipse cx="100" cy="190" rx="70" ry="60" fill="rgba(255,255,255,.55)"/>' + (txt ? '<text x="100" y="118" font-size="46" font-weight="700" text-anchor="middle" fill="#fff">' + txt + '</text>' : '') + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(s);
  }
  var overview = { x: 645.7196725473384, y: 340.2921393569175, ux: 0.20118507589946494, uy: -0.20138282875746794 };
  function world(px, py) { return [(px - overview.x) / overview.ux, (py - overview.y) / overview.uy, 0]; }

  state.teams = {
    left: { _id: 'L', name: 'Team Alpha', logo: svg('A', '#3a6fb5', '#1d3a63') },
    right: { _id: 'R', name: 'Team Bravo', logo: svg('B', '#c9962b', '#7a5612') }
  };
  state.match = { matchType: 'bo3', left: { id: 'L', wins: 1 }, right: { id: 'R', wins: 0 }, vetos: [] };
  state.config = { display_settings: { tournament_name: 'Sample League', tournament_stage: 'Matchday 7' } };

  var names = ['Anchor', 'Blaze', 'Cobalt', 'Drift', 'Echo', 'Falcon', 'Ghost', 'Hawk', 'Ion', 'Jinx'];
  var weapons = ['weapon_ak47', 'weapon_awp', 'weapon_m4a1_silencer', 'weapon_famas', 'weapon_mp9'];
  var players = names.map(function (n, i) {
    var ct = i < 5, id = '7656119800000000' + (10 + i);
    state.players[id] = { steamid: id, username: n, team: ct ? 'L' : 'R', avatar: svg('', ct ? '#2f5f9f' : '#9b7420', '#10151f') };
    return { id: id, name: n, ct: ct, px: 300 + Math.random() * 450, py: 250 + Math.random() * 500, hp: [100, 100, 71, 0, 100, 100, 84, 100, 0, 100][i], slot: i + 1 };
  });

  function build(t) {
    var all = {};
    players.forEach(function (p, i) {
      var pos = world(p.px + Math.sin(t / 900 + i) * 12, p.py + Math.cos(t / 1100 + i) * 12);
      all[p.id] = {
        name: p.name, observer_slot: p.slot === 10 ? 0 : p.slot, team: p.ct ? 'CT' : 'T',
        position: pos.join(', '), forward: Math.cos(i) + ', ' + Math.sin(i) + ', 0',
        state: { health: p.hp, armor: p.hp ? 100 : 0, helmet: i % 2 === 0, money: 800 + i * 650, defusekit: p.ct && i === 1 },
        match_stats: { kills: 3 + i, assists: i % 3, deaths: 2 + (i % 4), score: 10 },
        weapons: {
          weapon_0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
          weapon_1: { name: weapons[i % 5], type: i % 5 === 4 ? 'SubmachineGun' : (i % 5 === 1 ? 'SniperRifle' : 'Rifle'), state: i === 1 ? 'active' : 'holstered', ammo_clip: 24, ammo_reserve: 90 },
          weapon_2: { name: 'weapon_flashbang', type: 'Grenade', state: 'holstered', ammo_reserve: i % 2 },
          weapon_3: { name: i % 2 ? 'weapon_smokegrenade' : 'weapon_hegrenade', type: 'Grenade', state: 'holstered', ammo_reserve: 0 }
        }
      };
      if (!p.ct && i === 6) all[p.id].weapons.weapon_4 = { name: 'weapon_c4', type: 'C4', state: 'holstered' };
    });
    var obs = players[1];
    var left = Math.max(0, 95 - (t / 1000) % 95);
    return {
      map: { name: 'de_mirage', team_ct: { score: 12 }, team_t: { score: 5 }, round: 17 },
      phase_countdowns: { phase: 'live', phase_ends_in: String(left) },
      round: { phase: 'live' },
      player: Object.assign({ steamid: obs.id, name: obs.name, activity: 'playing', team: 'CT' }, all[obs.id]),
      allplayers: all
    };
  }
  var t0 = Date.now();
  setInterval(function () { state.gsi = build(Date.now() - t0); schedule(); }, 200);
  state.gsi = build(0); schedule();
};
