const https = require('https');

const FOGIS_API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';
const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';
const FOGIS_API = 'forening-api.svenskfotboll.se';

// SFK P16 kadrosu - PlayerID listesi
const SFK_PLAYER_IDS = new Set([
  583483, 562656, 659792, 571649, 572299, 597435, 700142, 595639,
  571652, 558820, 571659, 589844, 572290, 572006, 595633, 606521,
  700147, 576573, 571068, 595628, 573259
]);

const SFK_PLAYERS = {
  583483: { name: 'Gabriel Saadi', shirt: 1 },
  562656: { name: 'Alexander Hansen', shirt: 2 },
  659792: { name: 'Jeyson Sissah Nkanga Ngudi Jose', shirt: 3 },
  571649: { name: 'Filip Kjellgren', shirt: 4 },
  572299: { name: 'Alf Markusson', shirt: 5 },
  597435: { name: 'Linus Olofsson', shirt: 6 },
  700142: { name: 'Leo Olausson', shirt: 7 },
  595639: { name: 'Hugo Meyer', shirt: 8 },
  571652: { name: 'Gabriel Mocsary', shirt: 9 },
  558820: { name: 'Frank Lundh', shirt: 10 },
  571659: { name: 'Emil Wallberg', shirt: 11 },
  589844: { name: 'Vincent Ekström Lundin', shirt: 12 },
  572290: { name: 'Badou Badjan', shirt: 14 },
  572006: { name: 'Gus Stefansson', shirt: 16 },
  595633: { name: 'Cian Hogan', shirt: 17 },
  606521: { name: 'Aksel Yesil', shirt: 19 },
  700147: { name: 'Charlie Nordenson', shirt: 20 },
  576573: { name: 'Albin Nordin', shirt: 21 },
  571068: { name: 'Viggo Sejnäs', shirt: 31 },
  595628: { name: 'Valter Ekehov', shirt: 66 },
  573259: { name: 'Love Nytén', shirt: 77 },
};

// Tüm ligler
const LEAGUES = [
  { id: 59554,  type: 'lig',      team: 398871, label: 'P16 Div.1 2025' },
  { id: 129362, type: 'lig',      team: 398871, label: 'P16 Div.1 2026' },
  { id: 70389,  type: 'kupa',     team: 398871, label: 'P16 Ligacupen 2026' },
  { id: 69555,  type: 'hazirlik', team: 398871, label: 'P16 Träningsmatcher 2026' },
  { id: 69500,  type: 'lig',      team: 74782,  label: 'P17 Allsvenskan 2026' },
  { id: 70384,  type: 'kupa',     team: 74782,  label: 'P17 Ligacupen 2026' },
  { id: 70816,  type: 'hazirlik', team: 74782,  label: 'P17 Träningsmatcher 2026' },
];

function httpGet(host, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      host, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function getAccessToken() {
  const refreshToken = process.env.MINFOTBOLL_REFRESH_TOKEN;
  const accessToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
  if (!refreshToken || !accessToken) throw new Error('Token env variables eksik');
  const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', { accessToken, refreshToken });
  if (!result.AccessToken) throw new Error('Token yenileme basarisiz');
  return result.AccessToken;
}

function minfotbollGet(path, token) {
  return httpGet(MINFOTBOLL_API, path, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  });
}

function fogisGet(path) {
  return httpGet(FOGIS_API, `/club${path}`, {
    'ApiKey': FOGIS_API_KEY,
    'Accept': 'application/json'
  });
}

function matchesFilter(game, teamId, gameType, dateFrom, dateTo) {
  // Takım kontrolü
  if (game.HomeTeamID !== teamId && game.AwayTeamID !== teamId) return false;
  // Sadece tamamlanmış maçlar
  if (game.GameStatusID !== 3) return false;
  // Tarih filtresi
  if (dateFrom || dateTo) {
    const gameDate = new Date(game.GameTime);
    if (dateFrom && gameDate < new Date(dateFrom)) return false;
    if (dateTo && gameDate > new Date(dateTo + 'T23:59:59')) return false;
  }
  return true;
}

async function getPlayerStats(gameType, dateFrom, dateTo, token) {
  // Hangi ligleri tarayacağız
  const filteredLeagues = LEAGUES.filter(l => {
    if (gameType && gameType !== 'hepsi') return l.type === gameType;
    return true;
  });

  const playerStats = {};
  const processedGames = new Set();

  // Tüm ligleri paralel tara
  await Promise.all(filteredLeagues.map(async (league) => {
    try {
      const games = await minfotbollGet(`/api/leagueapi/getleaguegames?leagueId=${league.id}`, token);
      if (!Array.isArray(games)) return;

      const teamGames = games.filter(g => matchesFilter(g, league.team, league.type, dateFrom, dateTo));

      await Promise.all(teamGames.map(async (game) => {
        if (processedGames.has(game.GameID)) return;
        processedGames.add(game.GameID);

        try {
          const isHome = game.HomeTeamID === league.team;
          const [overview, lineups] = await Promise.all([
            minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${game.GameID}`, token),
            minfotbollGet(`/api/magazinegameviewapi/initgamelineups?GameID=${game.GameID}`, token)
          ]);

          // Lineup'tan oyuncuları al — PlayerID ile eşleştir
          const lineupTeam = isHome ? lineups.HomeTeamLineUp : lineups.AwayTeamLineUp;
          if (lineupTeam && lineupTeam.GameLineUpPlayers) {
            lineupTeam.GameLineUpPlayers.forEach(p => {
              if (!SFK_PLAYER_IDS.has(p.PlayerID)) return;
              const pid = p.PlayerID;
              if (!playerStats[pid]) {
                playerStats[pid] = {
                  playerId: pid,
                  name: SFK_PLAYERS[pid]?.name || p.FullName,
                  shirt: SFK_PLAYERS[pid]?.shirt || 0,
                  thumbnail: p.ThumbnailURL,
                  games: 0, goals: 0, assists: 0,
                  yellowCards: 0, redCards: 0,
                  ligGames: 0, kupaGames: 0, hazirlikGames: 0,
                };
              }
              playerStats[pid].games++;
              if (league.type === 'lig') playerStats[pid].ligGames++;
              else if (league.type === 'kupa') playerStats[pid].kupaGames++;
              else playerStats[pid].hazirlikGames++;
            });
          }

          // Olayları işle
          if (overview && overview.Blurbs) {
            overview.Blurbs.forEach(b => {
              const isOurTeam = isHome ? !b.IsAwayTeamAction : b.IsAwayTeamAction;
              if (!isOurTeam) return;

              // Oyuncu adından PlayerID bul
              const playerName = b.Title ? b.Title.replace(/^\d+\.\s*/, '').trim() : null;
              if (!playerName) return;

              // İsimden PlayerID eşleştir
              const pid = Object.keys(SFK_PLAYERS).find(id =>
                SFK_PLAYERS[id].name.toLowerCase() === playerName.toLowerCase() ||
                SFK_PLAYERS[id].name.toLowerCase().includes(playerName.toLowerCase())
              );
              if (!pid) return;
              const pidNum = parseInt(pid);
              if (!playerStats[pidNum]) return;

              if (b.TypeID === 1 && b.IsGoal) {
                playerStats[pidNum].goals++;
                if (b.Description && b.Description.includes('Assist av:')) {
                  const assistName = b.Description.replace('Assist av:', '').trim().replace(/^\d+\.\s*/, '').trim();
                  const assistPid = Object.keys(SFK_PLAYERS).find(id =>
                    SFK_PLAYERS[id].name.toLowerCase() === assistName.toLowerCase() ||
                    SFK_PLAYERS[id].name.toLowerCase().includes(assistName.toLowerCase())
                  );
                  if (assistPid && playerStats[parseInt(assistPid)]) {
                    playerStats[parseInt(assistPid)].assists++;
                  }
                }
              } else if (b.TypeID === 6) {
                playerStats[pidNum].yellowCards++;
              } else if (b.TypeID === 7) {
                playerStats[pidNum].redCards++;
              }
            });
          }
        } catch (e) {}
      }));
    } catch (e) {}
  }));

  // Tüm 22 oyuncuyu listele, oynamayanlar 0 ile
  const allPlayers = Object.keys(SFK_PLAYERS).map(pid => {
    const pidNum = parseInt(pid);
    return playerStats[pidNum] || {
      playerId: pidNum,
      name: SFK_PLAYERS[pid].name,
      shirt: SFK_PLAYERS[pid].shirt,
      thumbnail: null,
      games: 0, goals: 0, assists: 0,
      yellowCards: 0, redCards: 0,
      ligGames: 0, kupaGames: 0, hazirlikGames: 0,
    };
  });

  return {
    players: allPlayers.sort((a, b) => b.goals - a.goals || b.games - a.games),
    totalGames: processedGames.size,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const action = req.query.action || 'fogis';
  const path = req.query.path || '/details';

  try {
    if (action === 'fogis') {
      const data = await fogisGet(path);
      return res.status(200).json(data);
    }

    if (action === 'stats') {
      const gameType = req.query.type || 'hepsi';  // lig, kupa, hazirlik, hepsi
      const dateFrom = req.query.from || '';
      const dateTo = req.query.to || '';
      const token = await getAccessToken();
      const stats = await getPlayerStats(gameType, dateFrom, dateTo, token);
      return res.status(200).json(stats);
    }

    res.status(400).json({ error: 'Gecersiz action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
