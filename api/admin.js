const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'sfk2026gizliAnahtar!';
const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';

const SFK_PLAYER_IDS = new Set([
  583483,562656,659792,571649,572299,597435,700142,595639,
  571652,558820,571659,589844,572290,572006,595633,606521,
  700147,576573,571068,65947,595628,573259
]);

const SFK_PLAYERS = {
  583483:{name:'Gabriel Saadi',shirt:1},
  562656:{name:'Alexander Hansen',shirt:2},
  659792:{name:'Jeyson Sissah Nkanga Ngudi Jose',shirt:3},
  571649:{name:'Filip Kjellgren',shirt:4},
  572299:{name:'Alf Markusson',shirt:5},
  597435:{name:'Linus Olofsson',shirt:6},
  700142:{name:'Leo Olausson',shirt:7},
  595639:{name:'Hugo Meyer',shirt:8},
  571652:{name:'Gabriel Mocsary',shirt:9},
  558820:{name:'Frank Lundh',shirt:10},
  571659:{name:'Emil Wallberg',shirt:11},
  589844:{name:'Vincent Ekström Lundin',shirt:12},
  572290:{name:'Badou Badjan',shirt:14},
  572006:{name:'Gus Stefansson',shirt:16},
  595633:{name:'Cian Hogan',shirt:17},
  606521:{name:'Aksel Yesil',shirt:19},
  700147:{name:'Charlie Nordenson',shirt:20},
  576573:{name:'Albin Nordin',shirt:21},
  571068:{name:'Viggo Sejnäs',shirt:31},
  65947:{name:'Leonel Mikhail',shirt:35},
  595628:{name:'Valter Ekehov',shirt:66},
  573259:{name:'Love Nytén',shirt:77},
};

const LEAGUES = [
  {id:59554, type:'lig',      team:398871, label:'P16 Div.1 2025'},
  {id:129362,type:'lig',      team:398871, label:'P16 Div.1 2026'},
  {id:70389, type:'kupa',     team:398871, label:'P16 Ligacupen 2026'},
  {id:59382, type:'hazirlik', team:398871, label:'P16 Träningsmatcher 2025'},
  {id:69555, type:'hazirlik', team:398871, label:'P16 Träningsmatcher 2026'},
  {id:69500, type:'lig',      team:74782,  label:'P17 Allsvenskan 2026'},
  {id:70384, type:'kupa',     team:74782,  label:'P17 Ligacupen 2026'},
  {id:70816, type:'hazirlik', team:74782,  label:'P17 Träningsmatcher 2026'},
];

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch(e) { return null; }
}

function httpGet(host, path, headers={}) {
  return new Promise((resolve, reject) => {
    const req = https.request({host, path, method:'GET', headers}, (res) => {
      let data='';
      res.on('data', chunk => data+=chunk);
      res.on('end', () => { try{resolve(JSON.parse(data))}catch(e){resolve(data)} });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(host, path, body, headers={}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      host, path, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr),...headers}
    }, (res) => {
      let data='';
      res.on('data', chunk => data+=chunk);
      res.on('end', () => { try{resolve(JSON.parse(data))}catch(e){resolve(data)} });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function supabaseRequest(method, path, body) {
  const url = new URL(SUPABASE_URL);
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  return httpPost(url.host, `/rest/v1${path}`, body || {}, headers)
    .catch(() => null);
}

function supabaseGet(path) {
  return httpGet(new URL(SUPABASE_URL).host, `/rest/v1${path}`, {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  });
}

async function getMinfotbollToken() {
  const refreshToken = process.env.MINFOTBOLL_REFRESH_TOKEN;
  const accessToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
  const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', {accessToken, refreshToken});
  if (!result.AccessToken) throw new Error('MinFotboll token alınamadı');
  return result.AccessToken;
}

function minfotbollGet(path, token) {
  return httpGet(MINFOTBOLL_API, path, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  });
}

function getGameType(leagueName) {
  if (!leagueName) return 'hazirlik';
  const l = leagueName.toLowerCase();
  if (l.includes('träning')) return 'hazirlik';
  if (l.includes('cup') || l.includes('cupen')) return 'kupa';
  return 'lig';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Token doğrula
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Giriş yapın' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin yetkisi gerekli' });

  const action = req.query.action;

  // Maçları çek (önizleme)
  if (action === 'fetchmatches') {
    const { gameType, dateFrom, dateTo } = req.query;
    const mfToken = await getMinfotbollToken();

    const filteredLeagues = LEAGUES.filter(l => {
      if (gameType && gameType !== 'hepsi') return l.type === gameType;
      return true;
    });

    const allGames = [];
    const seen = new Set();

    await Promise.all(filteredLeagues.map(async (league) => {
      try {
        const games = await minfotbollGet(`/api/leagueapi/getleaguegames?leagueId=${league.id}`, mfToken);
        if (!Array.isArray(games)) return;
        games.forEach(g => {
          if (seen.has(g.GameID)) return;
          if (g.HomeTeamID !== league.team && g.AwayTeamID !== league.team) return;
          if (g.GameStatusID !== 3) return;
          if (dateFrom && new Date(g.GameTime) < new Date(dateFrom)) return;
          if (dateTo && new Date(g.GameTime) > new Date(dateTo + 'T23:59:59')) return;
          seen.add(g.GameID);
          allGames.push({
            gameId: g.GameID,
            gameDate: g.GameTime,
            homeTeam: g.HomeTeamDisplayName,
            awayTeam: g.AwayTeamDisplayName,
            homeScore: g.HomeTeamScore,
            awayScore: g.AwayTeamScore,
            leagueName: league.label,
            gameType: league.type,
            teamId: league.team,
          });
        });
      } catch(e) {}
    }));

    allGames.sort((a,b) => new Date(b.gameDate) - new Date(a.gameDate));
    return res.status(200).json(allGames);
  }

  // Maç detayı çek (oyuncular + olaylar)
  if (action === 'matchdetail') {
    const { gameId, teamId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'gameId gerekli' });

    const mfToken = await getMinfotbollToken();
    const tid = parseInt(teamId);

    const [overview, lineups, header] = await Promise.all([
      minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken),
      minfotbollGet(`/api/magazinegameviewapi/initgamelineups?GameID=${gameId}`, mfToken),
      minfotbollGet(`/api/gameapi/getgameheaderinfo?id=${gameId}`, mfToken),
    ]);

    const isHome = header.HomeTeamID === tid;
    const lineupTeam = isHome ? lineups.HomeTeamLineUp : lineups.AwayTeamLineUp;

    // Sadece o maçta oynayan SFK oyuncuları
    const playedPlayerIds = new Set();
    const playerThumbnails = {};
    const playerPositions = {};
    const playerShirtNos = {};
    if (lineupTeam && lineupTeam.GameLineUpPlayers) {
      lineupTeam.GameLineUpPlayers.forEach(p => {
        if (SFK_PLAYER_IDS.has(p.PlayerID)) {
          playedPlayerIds.add(p.PlayerID);
          playerThumbnails[p.PlayerID] = p.ThumbnailURL;
          playerPositions[p.PlayerID] = p.Position || '';
          playerShirtNos[p.PlayerID] = p.ShirtNumber || SFK_PLAYERS[p.PlayerID]?.shirt || 0;
        }
      });
    }
    // Olayları işle
    const events = { goals:{}, assists:{}, yellowCards:{}, redCards:{} };
    if (overview && overview.Blurbs) {
      overview.Blurbs.forEach(b => {
        const isOurTeam = isHome ? !b.IsAwayTeamAction : b.IsAwayTeamAction;
        if (!isOurTeam) return;
        const playerName = b.Title ? b.Title.replace(/^\d+\.\s*/, '').trim() : null;
        if (!playerName) return;

        const pid = parseInt(Object.keys(SFK_PLAYERS).find(id => {
          const n = SFK_PLAYERS[id].name.toLowerCase();
          return n === playerName.toLowerCase() || n.includes(playerName.toLowerCase());
        }));
        if (!pid) return;

        if (b.TypeID === 1 && b.IsGoal) {
          events.goals[pid] = (events.goals[pid] || 0) + 1;
          const assistPrefix = b.Description && (b.Description.includes('Assist av:') ? 'Assist av:' : b.Description.includes('Assist by:') ? 'Assist by:' : null);
          if (assistPrefix) {
            const assistName = b.Description.replace(assistPrefix, '').trim().replace(/^\d+\.\s*/, '').trim();
            const apid = parseInt(Object.keys(SFK_PLAYERS).find(id => {
              const n = SFK_PLAYERS[id].name.toLowerCase();
              return n === assistName.toLowerCase() || n.includes(assistName.toLowerCase());
            }));
            if (apid) events.assists[apid] = (events.assists[apid] || 0) + 1;
          }
        } else if (b.TypeID === 6) {
          events.yellowCards[pid] = (events.yellowCards[pid] || 0) + 1;
        } else if (b.TypeID === 7) {
          events.redCards[pid] = (events.redCards[pid] || 0) + 1;
        }
      });
    }

    // SADECE o maçta oynayan SFK oyuncuları
    const players = [...playedPlayerIds].map(pidNum => ({
      playerId: pidNum,
      name: SFK_PLAYERS[pidNum].name,
      shirt: playerShirtNos[pidNum] || SFK_PLAYERS[pidNum].shirt,
      thumbnail: playerThumbnails[pidNum] || null,
      position: playerPositions[pidNum] || '',
      isGoalkeeper: (playerPositions[pidNum] || '').includes('Goalkeeper'),
      isStarter: (playerPositions[pidNum] || '') !== '' && !(playerPositions[pidNum] || '').includes('NotSelected'),
      played: true,
      selected: true,
      goals: events.goals[pidNum] || 0,
      assists: events.assists[pidNum] || 0,
      yellowCards: events.yellowCards[pidNum] || 0,
      redCards: events.redCards[pidNum] || 0,
    })).sort((a,b) => a.shirt - b.shirt);
    return res.status(200).json({
      gameId: parseInt(gameId),
      homeTeam: header.HomeTeamDisplayName,
      awayTeam: header.AwayTeamDisplayName,
      homeScore: header.HomeTeamScore,
      awayScore: header.AwayTeamScore,
      gameDate: header.GameTime,
      leagueName: header.LeagueName,
      gameType: getGameType(header.LeagueName),
      players,
    });
  }

  // Maçı onayla ve database'e kaydet
  if (action === 'savematch' && req.method === 'POST') {
    const { gameId, gameDate, homeTeam, awayTeam, homeScore, awayScore,
            leagueName, gameType, players } = req.body || {};

    if (!gameId || !players) return res.status(400).json({ error: 'Eksik bilgi' });

    // Maç zaten kayıtlı mı?
    const existing = await supabaseGet(`/matches?game_id=eq.${gameId}&select=id`);
    let matchId;

    if (Array.isArray(existing) && existing.length > 0) {
      matchId = existing[0].id;
      // Güncelle
      await httpPost(new URL(SUPABASE_URL).host, `/rest/v1/matches?id=eq.${matchId}`, {
        game_date: gameDate, home_team: homeTeam, away_team: awayTeam,
        home_score: homeScore, away_score: awayScore,
        league_name: leagueName, game_type: gameType,
        approved_by: user.id, approved_at: new Date().toISOString(),
      }, {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'X-HTTP-Method-Override': 'PATCH',
      });
    } else {
      // Yeni maç ekle
      const match = await supabaseRequest('POST', '/matches', {
        game_id: gameId, game_date: gameDate, home_team: homeTeam,
        away_team: awayTeam, home_score: parseInt(homeScore),
        away_score: parseInt(awayScore), league_name: leagueName,
        game_type: gameType, approved_by: user.id,
        approved_at: new Date().toISOString(),
      });
      matchId = Array.isArray(match) ? match[0].id : match.id;
    }

    // Oyuncu istatistiklerini kaydet
    for (const p of players) {
      const existingStat = await supabaseGet(`/player_stats?match_id=eq.${matchId}&player_id=eq.${p.playerId}&select=id`);
      if (Array.isArray(existingStat) && existingStat.length > 0) {
        // Güncelle - PATCH
        await httpGet(new URL(SUPABASE_URL).host, `/rest/v1/player_stats?id=eq.${existingStat[0].id}`, {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        });
      } else {
        await supabaseRequest('POST', '/player_stats', {
          match_id: matchId,
          player_id: p.playerId,
          player_name: p.name,
          shirt_number: p.shirt,
          played: p.played,
          goals: p.goals || 0,
          assists: p.assists || 0,
          yellow_cards: p.yellowCards || 0,
          red_cards: p.redCards || 0,
        });
      }
    }

    return res.status(200).json({ success: true, matchId });
  }

  // Kayıtlı maçları listele
  if (action === 'savedmatches') {
    const matches = await supabaseGet('/matches?select=*&order=game_date.desc');
    return res.status(200).json(matches);
  }

  res.status(400).json({ error: 'Geçersiz action' });
};
