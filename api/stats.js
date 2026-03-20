const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'sfk2026gizliAnahtar!';

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
  595628:{name:'Valter Ekehov',shirt:66},
  573259:{name:'Love Nytén',shirt:77},
};

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

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL);
    const req = https.request({
      host: url.host,
      path: `/rest/v1${path}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try{resolve(JSON.parse(data))}catch(e){resolve(data)} });
    });
    req.on('error', reject);
    req.end();
  });
}

const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';

function minfotbollGet(path, token) {
  return httpGet(MINFOTBOLL_API, path, { 'Authorization': `Bearer ${token}` });
}

async function getMinfotbollToken() {
  const refreshToken = process.env.MINFOTBOLL_REFRESH_TOKEN;
  const accessToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
  const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', {accessToken, refreshToken});
  if (!result?.AccessToken) throw new Error('MinFotboll token alınamadı');
  return result.AccessToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Giriş yapın' });

  const action = req.query.action;

  // Tüm oyuncu istatistikleri (admin + antrenör)
  if (action === 'playerstats') {
    if (user.role === 'oyuncu') return res.status(403).json({ error: 'Yetki yok' });

    const { gameType, dateFrom, dateTo } = req.query;

    // Maçları filtrele
    let matchQuery = '/matches?select=*';
    if (gameType && gameType !== 'hepsi') matchQuery += `&game_type=eq.${gameType}`;
    if (dateFrom) matchQuery += `&game_date=gte.${dateFrom}`;
    if (dateTo) matchQuery += `&game_date=lte.${dateTo}T23:59:59`;

    const matches = await supabaseGet(matchQuery);
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(200).json({ players: [], totalGames: 0 });
    }

    const matchIds = matches.map(m => m.id);
    const stats = await supabaseGet(`/player_stats?match_id=in.(${matchIds.join(',')})&select=*`);

    // Oyuncu bazında topla
    const playerMap = {};
    if (Array.isArray(stats)) {
      stats.forEach(s => {
        if (!playerMap[s.player_id]) {
          playerMap[s.player_id] = {
            playerId: s.player_id,
            name: SFK_PLAYERS[s.player_id]?.name || s.player_name,
            shirt: SFK_PLAYERS[s.player_id]?.shirt || 0,
            games: 0, starterGames: 0, goals: 0, assists: 0,
            yellowCards: 0, redCards: 0, minutesPlayed: 0,
          };
        }
        if (s.played) {
          playerMap[s.player_id].games++;
          if (s.is_starter) playerMap[s.player_id].starterGames++;
          playerMap[s.player_id].minutesPlayed += s.minutes_played || 0;
        }
        playerMap[s.player_id].goals += s.goals || 0;
        playerMap[s.player_id].assists += s.assists || 0;
        playerMap[s.player_id].yellowCards += s.yellow_cards || 0;
        playerMap[s.player_id].redCards += s.red_cards || 0;
      });
    }

    // Tüm 22 oyuncuyu listele
    const players = Object.keys(SFK_PLAYERS).map(pid => {
      const pidNum = parseInt(pid);
      return playerMap[pidNum] || {
        playerId: pidNum,
        name: SFK_PLAYERS[pid].name,
        shirt: SFK_PLAYERS[pid].shirt,
        games: 0, goals: 0, assists: 0,
        yellowCards: 0, redCards: 0,
      };
    });

    // Dakikaya göre sırala, ortalamalar ekle
    players.forEach(p => {
      p.goalsPerGame = p.games > 0 ? Math.round((p.goals / p.games) * 100) / 100 : 0;
      p.minutesPerGoal = p.goals > 0 ? Math.round(p.minutesPlayed / p.goals) : null;
      p.minutesPerGame = p.games > 0 ? Math.round(p.minutesPlayed / p.games) : 0;
    });
    const sorted = players.sort((a,b) => b.minutesPlayed - a.minutesPlayed || b.goals - a.goals);

    return res.status(200).json({
      players: sorted,
      totalGames: matches.length,
      matches: matches.map(m => ({
        id: m.id, gameId: m.game_id, gameDate: m.game_date,
        homeTeam: m.home_team, awayTeam: m.away_team,
        homeScore: m.home_score, awayScore: m.away_score,
        leagueName: m.league_name, gameType: m.game_type,
      })),
    });
  }

  // Kendi istatistikleri (oyuncu)
  if (action === 'mystats') {
    const playerId = user.player_id;
    if (!playerId) return res.status(400).json({ error: 'Player ID tanımlı değil' });

    const stats = await supabaseGet(`/player_stats?player_id=eq.${playerId}&select=*,matches(*)`);
    if (!Array.isArray(stats)) return res.status(200).json({ stats: [] });

    // Thumbnail'i player_stats'tan al, yoksa MinFotboll'dan çek
    const thumbnailRow = await supabaseGet(`/player_stats?player_id=eq.${playerId}&select=thumbnail&limit=1`);
    let thumbnail = Array.isArray(thumbnailRow) && thumbnailRow[0]?.thumbnail || null;
    
    // DB'de yoksa MinFotboll'dan çek
    if (!thumbnail) {
      try {
        const mfToken = await getMinfotbollToken();
        const teamId = 398871; // P16 team
        const roster = await minfotbollGet(`/api/teamapi/initplayersadminvc?TeamID=${teamId}`, mfToken);
        if (Array.isArray(roster)) {
          const player = roster.find(p => p.PlayerID === playerId);
          if (player?.ThumbnailURL) thumbnail = player.ThumbnailURL;
        }
      } catch(e) {}
    }

    const summary = {
      playerId,
      name: SFK_PLAYERS[playerId]?.name || user.full_name,
      shirt: SFK_PLAYERS[playerId]?.shirt || 0,
      thumbnail,
      games: 0, starterGames: 0, minutesPlayed: 0,
      goals: 0, assists: 0, yellowCards: 0, redCards: 0,
      matchDetails: [],
    };

    stats.forEach(s => {
      if (s.played) {
        summary.games++;
        if (s.is_starter) summary.starterGames++;
        summary.minutesPlayed += s.minutes_played || 0;
      }
      summary.goals += s.goals || 0;
      summary.assists += s.assists || 0;
      summary.yellowCards += s.yellow_cards || 0;
      summary.redCards += s.red_cards || 0;
      if (s.played) {
        summary.matchDetails.push({
          gameDate: s.matches?.game_date,
          homeTeam: s.matches?.home_team,
          awayTeam: s.matches?.away_team,
          homeScore: s.matches?.home_score,
          awayScore: s.matches?.away_score,
          leagueName: s.matches?.league_name,
          isStarter: s.is_starter,
          minutesPlayed: s.minutes_played || 0,
          goals: s.goals, assists: s.assists,
          yellowCards: s.yellow_cards, redCards: s.red_cards,
        });
      }
    });

    summary.matchDetails.sort((a,b) => new Date(b.gameDate) - new Date(a.gameDate));
    return res.status(200).json(summary);
  }

  res.status(400).json({ error: 'Geçersiz action' });
};
