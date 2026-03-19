const https = require('https');

const FOGIS_API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';
const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';
const FOGIS_API = 'forening-api.svenskfotboll.se';

const P16_TEAM_ID = 457347;
const P17_TEAM_ID = 74782;
const P16_LEAGUE_ID = 59554;
const P17_LEAGUE_ID = 70384;

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

function httpPost(host, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      host, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
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
  if (!refreshToken || !accessToken) throw new Error('MinFotboll token env variables eksik');
  const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', {
    accessToken, refreshToken
  });
  if (!result.AccessToken) throw new Error('Token yenileme basarisiz: ' + JSON.stringify(result));
  return result.AccessToken;
}

async function minfotbollGet(path, token) {
  return httpGet(MINFOTBOLL_API, path, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  });
}

async function fogisGet(path) {
  return httpGet(FOGIS_API, `/club${path}`, {
    'ApiKey': FOGIS_API_KEY,
    'Accept': 'application/json'
  });
}

async function getPlayerStats(teamId, leagueId, token) {
  const games = await minfotbollGet(`/api/leagueapi/getleaguegames?leagueId=${leagueId}`, token);
  if (!Array.isArray(games)) return { players: [], gamesPlayed: 0 };

  const teamGames = games.filter(g =>
    (g.HomeTeamID === teamId || g.AwayTeamID === teamId) &&
    g.GameStatusID === 3
  );

  const playerStats = {};

  await Promise.all(teamGames.map(async (game) => {
    try {
      const isHome = game.HomeTeamID === teamId;
      const [overview, lineups] = await Promise.all([
        minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${game.GameID}`, token),
        minfotbollGet(`/api/magazinegameviewapi/initgamelineups?GameID=${game.GameID}`, token)
      ]);

      const lineupTeam = isHome ? lineups.HomeTeamLineUp : lineups.AwayTeamLineUp;
      if (lineupTeam && lineupTeam.GameLineUpPlayers) {
        lineupTeam.GameLineUpPlayers.forEach(p => {
          if (!playerStats[p.FullName]) {
            playerStats[p.FullName] = { name: p.FullName, thumbnail: p.ThumbnailURL, games: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
          }
          playerStats[p.FullName].games++;
        });
      }

      if (overview && overview.Blurbs) {
        overview.Blurbs.forEach(b => {
          const isOurTeam = isHome ? !b.IsAwayTeamAction : b.IsAwayTeamAction;
          if (!isOurTeam) return;
          const playerName = b.Title ? b.Title.replace(/^\d+\.\s*/, '').trim() : null;
          if (!playerName) return;
          if (!playerStats[playerName]) {
            playerStats[playerName] = { name: playerName, thumbnail: null, games: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
          }
          if (b.TypeID === 1 && b.IsGoal) {
            playerStats[playerName].goals++;
            if (b.Description && b.Description.includes('Assist av:')) {
              const assistName = b.Description.replace('Assist av:', '').replace(/^\d+\.\s*/, '').trim();
              if (!playerStats[assistName]) {
                playerStats[assistName] = { name: assistName, thumbnail: null, games: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
              }
              playerStats[assistName].assists++;
            }
          } else if (b.TypeID === 6) {
            playerStats[playerName].yellowCards++;
          } else if (b.TypeID === 7) {
            playerStats[playerName].redCards++;
          }
        });
      }
    } catch (e) {}
  }));

  const skipWords = ['half start', 'half end', 'whistle', 'period', 'start', 'slut', 'halvlek', 'first half', 'second half'];
  const cleanPlayers = Object.values(playerStats).filter(p => {
    if (p.games === 0) return false;
    const nameLower = p.name.toLowerCase();
    if (skipWords.some(w => nameLower.includes(w))) return false;
    if (p.name.trim() === '—' || p.name.trim() === '' || p.name.trim() === '-') return false;
    return true;
  });

  return {
    players: cleanPlayers.sort((a, b) => b.goals - a.goals),
    gamesPlayed: teamGames.length
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
      const team = req.query.team || 'p16';
      const token = await getAccessToken();
      const teamId = team === 'p17' ? P17_TEAM_ID : P16_TEAM_ID;
      const leagueId = team === 'p17' ? P17_LEAGUE_ID : P16_LEAGUE_ID;
      const stats = await getPlayerStats(teamId, leagueId, token);
      return res.status(200).json(stats);
    }

    if (action === 'games') {
      const team = req.query.team || 'p16';
      const token = await getAccessToken();
      const teamId = team === 'p17' ? P17_TEAM_ID : P16_TEAM_ID;
      const leagueId = team === 'p17' ? P17_LEAGUE_ID : P16_LEAGUE_ID;
      const games = await minfotbollGet(`/api/leagueapi/getleaguegames?leagueId=${leagueId}`, token);
      const teamGames = Array.isArray(games)
        ? games.filter(g => g.HomeTeamID === teamId || g.AwayTeamID === teamId)
        : [];
      return res.status(200).json(teamGames);
    }

    res.status(400).json({ error: 'Gecersiz action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
