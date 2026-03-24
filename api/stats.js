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

const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';

function minfotbollGet(path, token) {
  return httpGet(MINFOTBOLL_API, path, { 'Authorization': `Bearer ${token}` });
}

async function getMinfotbollToken() {
  const refreshToken = process.env.MINFOTBOLL_REFRESH_TOKEN;
  const accessToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
  const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', {accessToken, refreshToken});
  if (!result?.AccessToken) throw new Error('MinFotboll-token kunde inte hämtas');
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
  if (!user) return res.status(401).json({ error: 'Vänligen logga in' });

  const action = req.query.action;

  // Tüm oyuncu istatistikleri (admin + antrenör)
  if (action === 'playerstats') {
    if (user.role === 'oyuncu') return res.status(403).json({ error: 'Yetki yok' });

    const { gameType, dateFrom, dateTo, leagueNames } = req.query;
    const leagueNameList = leagueNames ? leagueNames.split('|') : [];

    // Maçları filtrele
    let matchQuery = '/matches?select=*';
    if (gameType && gameType !== 'hepsi') matchQuery += `&game_type=eq.${gameType}`;
    if (dateFrom) matchQuery += `&game_date=gte.${dateFrom}`;
    if (dateTo) matchQuery += `&game_date=lte.${dateTo}T23:59:59`;

    let matches = await supabaseGet(matchQuery);
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(200).json({ players: [], totalGames: 0 });
    }
    // Lig ismine göre filtrele
    if (leagueNameList.length > 0) {
      matches = matches.filter(m => leagueNameList.includes(m.league_name));
    }
    if (matches.length === 0) {
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
    if (!playerId) return res.status(400).json({ error: 'Spelar-ID är inte definierat' });

    // Filtreleme parametreleri
    const { gameType, dateFrom, dateTo, leagueNames: myLeagueNames } = req.query;
    const myLeagueList = myLeagueNames ? myLeagueNames.split('|') : [];

    // Önce maçları filtrele
    let matchQuery = '/matches?select=id,league_name';
    if (gameType && gameType !== 'hepsi') matchQuery += `&game_type=eq.${gameType}`;
    if (dateFrom) matchQuery += `&game_date=gte.${dateFrom}`;
    if (dateTo) matchQuery += `&game_date=lte.${dateTo}T23:59:59`;
    let filteredMatches = await supabaseGet(matchQuery);
    if (myLeagueList.length > 0 && Array.isArray(filteredMatches)) {
      filteredMatches = filteredMatches.filter(m => myLeagueList.includes(m.league_name));
    }
    const matchIds = Array.isArray(filteredMatches) ? filteredMatches.map(m => m.id) : [];

    let statsQuery = `/player_stats?player_id=eq.${playerId}&select=*,matches(*)`;
    if (matchIds.length > 0 && (gameType || dateFrom || dateTo)) {
      statsQuery = `/player_stats?player_id=eq.${playerId}&match_id=in.(${matchIds.join(',')})&select=*,matches(*)`;
    } else if (matchIds.length === 0 && (gameType || dateFrom || dateTo)) {
      return res.status(200).json({ playerId, name: SFK_PLAYERS[playerId]?.name, shirt: SFK_PLAYERS[playerId]?.shirt || 0, games: 0, starterGames: 0, minutesPlayed: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, matchDetails: [] });
    }

    const stats = await supabaseGet(statsQuery);
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

  // Belirli oyuncu için CV verisi (admin + antrenör)
  if (action === 'playercv') {
    if (user.role === 'oyuncu') return res.status(403).json({ error: 'Yetki yok' });
    const playerId = parseInt(req.query.playerId);
    if (!playerId || !SFK_PLAYERS[playerId]) return res.status(400).json({ error: 'Ogiltigt spelar-ID' });

    const statsRaw = await supabaseGet(`/player_stats?player_id=eq.${playerId}&select=*,matches(*)&order=matches(game_date).desc`);
    if (!Array.isArray(statsRaw)) return res.status(200).json({ error: 'Ingen data' });

    // Thumbnail
    const thumbnailRow = await supabaseGet(`/player_stats?player_id=eq.${playerId}&select=thumbnail&limit=1`);
    let thumbnail = Array.isArray(thumbnailRow) && thumbnailRow[0]?.thumbnail || null;
    if (!thumbnail) {
      try {
        const mfToken = await getMinfotbollToken();
        const roster = await minfotbollGet(`/api/teamapi/initplayersadminvc?TeamID=398871`, mfToken);
        if (Array.isArray(roster)) {
          const p = roster.find(p => p.PlayerID === playerId);
          if (p?.ThumbnailURL) thumbnail = p.ThumbnailURL;
        }
      } catch(e) {}
    }

    // Toplam istatistikler
    const totals = { games:0, starterGames:0, minutesPlayed:0, goals:0, assists:0, yellowCards:0, redCards:0 };
    const seasonMap = {};

    statsRaw.forEach(s => {
      const year = s.matches?.game_date ? new Date(s.matches.game_date).getFullYear() : 'Okänt';
      if (!seasonMap[year]) seasonMap[year] = { season: year, league: '', games:0, goals:0, assists:0, minutesPlayed:0, leagueNames: new Set() };
      if (s.played) {
        totals.games++;
        if (s.is_starter) totals.starterGames++;
        totals.minutesPlayed += s.minutes_played || 0;
        seasonMap[year].games++;
        seasonMap[year].minutesPlayed += s.minutes_played || 0;
        if (s.matches?.league_name) seasonMap[year].leagueNames.add(s.matches.league_name);
      }
      totals.goals += s.goals || 0;
      totals.assists += s.assists || 0;
      totals.yellowCards += s.yellow_cards || 0;
      totals.redCards += s.red_cards || 0;
      seasonMap[year].goals += s.goals || 0;
      seasonMap[year].assists += s.assists || 0;
    });

    const seasons = Object.values(seasonMap)
      .map(s => ({ ...s, league: [...s.leagueNames].join(', ') || 'SFK' }))
      .sort((a,b) => b.season - a.season);

    // Maç detayları
    const matchDetails = statsRaw
      .filter(s => s.played)
      .map(s => ({
        gameDate: s.matches?.game_date,
        homeTeam: s.matches?.home_team,
        awayTeam: s.matches?.away_team,
        homeScore: s.matches?.home_score,
        awayScore: s.matches?.away_score,
        leagueName: s.matches?.league_name,
        gameType: s.matches?.game_type,
        isStarter: s.is_starter,
        minutesPlayed: s.minutes_played || 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        yellowCards: s.yellow_cards || 0,
        redCards: s.red_cards || 0,
      }))
      .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

    return res.status(200).json({
      name: SFK_PLAYERS[playerId].name,
      shirt: SFK_PLAYERS[playerId].shirt,
      thumbnail,
      playerId,
      totals,
      seasons,
      matchDetails,
      videos: []
    });
  }

  // Oyuncu video highlights (otomatik MinFotboll'dan)
  if (action === 'playervideos') {
    const playerId = parseInt(req.query.playerId);
    if (!playerId) return res.status(400).json({ error: 'playerId krävs' });

    try {
      const mfToken = await getMinfotbollToken();

      // 1. Oyuncunun TeamPlayerID'sini bul
      const teamId = 398871; // P16
      const roster = await minfotbollGet(`/api/teamapi/initplayersadminvc?TeamID=${teamId}`, mfToken);
      let teamPlayerID = null;
      if (Array.isArray(roster)) {
        const player = roster.find(p => p.PlayerID === playerId);
        if (player) teamPlayerID = player.TeamPlayerID || player.MemberID || null;
      }

      if (!teamPlayerID) {
        return res.status(200).json({ videos: [], note: 'TeamPlayerID hittades inte' });
      }

      // 2. Highlights çek - birkaç olası endpoint dene
      let videos = [];

      // Deneme 1: highlights endpoint
      try {
        const highlights = await minfotbollGet(`/api/teamplayerapi/gethighlights?TeamPlayerID=${teamPlayerID}`, mfToken);
        if (Array.isArray(highlights) && highlights.length > 0) {
          videos = highlights.map(h => ({
            label: h.Title || h.MatchName || h.GameName || 'Höjdpunkt',
            url: h.URL || h.VideoURL || h.Link || h.ExternalURL || null,
            date: h.GameDate || h.Date || null,
            gameId: h.GameID || null,
          })).filter(v => v.url);
        }
      } catch(e) {}

      // Deneme 2: player media
      if (!videos.length) {
        try {
          const media = await minfotbollGet(`/api/playerapi/getplayermedia?PlayerId=${playerId}`, mfToken);
          if (Array.isArray(media) && media.length > 0) {
            videos = media.map(m => ({
              label: m.Title || m.MatchName || 'Video',
              url: m.URL || m.VideoURL || m.MediaURL || null,
              date: m.Date || null,
            })).filter(v => v.url);
          }
        } catch(e) {}
      }

      // Deneme 3: teamplayer highlights
      if (!videos.length) {
        try {
          const h2 = await minfotbollGet(`/api/teamplayerapi/highlights?id=${teamPlayerID}`, mfToken);
          if (Array.isArray(h2) && h2.length > 0) {
            videos = h2.map(h => ({
              label: h.Title || h.MatchName || 'Höjdpunkt',
              url: h.URL || h.VideoURL || h.Link || null,
              date: h.GameDate || h.Date || null,
            })).filter(v => v.url);
          }
        } catch(e) {}
      }

      // Maç bazlı video/highlight arama
      // Oyuncunun oynadığı maçları DB'den çek
      const playerMatches = await supabaseGet(
        `/player_stats?player_id=eq.${playerId}&select=match_id,matches(game_id,game_date,home_team,away_team)&order=matches(game_date).desc&limit=20`
      );

      const debugInfo = { teamPlayerID, playerId, matchCount: Array.isArray(playerMatches) ? playerMatches.length : 0, matchResults: [] };

      if (Array.isArray(playerMatches)) {
        for (const ps of playerMatches.slice(0, 5)) { // ilk 5 maçı dene
          const gameId = ps.matches?.game_id;
          if (!gameId) continue;
          try {
            // Her maçın blurb'larını çek - EREventInfo içinde video URL olabilir
            const blurbs = await minfotbollGet(`/api/followgameapi/initlivetimelineblurbs?GameID=${gameId}`, mfToken);
            const blurbArr = Array.isArray(blurbs) ? blurbs : (blurbs?.Blurbs || []);
            
            // Oyuncuya ait blurb'ları filtrele
            const playerBlurbs = blurbArr.filter(b => 
              b.PlayerID === playerId || b.Player1ID === playerId || b.Player2ID === playerId
            );

            // Video URL olan blurb'ları bul
            const videoBlurbs = blurbArr.filter(b => 
              b.EREventInfo?.VideoURL || b.VideoURL || b.EREventInfo?.ExternalVideoURL
            );

            debugInfo.matchResults.push({
              gameId,
              date: ps.matches?.game_date,
              match: (ps.matches?.home_team || '') + ' vs ' + (ps.matches?.away_team || ''),
              totalBlurbs: blurbArr.length,
              playerBlurbs: playerBlurbs.length,
              videoBlurbs: videoBlurbs.length,
              sampleBlurb: blurbArr[0] ? Object.keys(blurbArr[0]) : [],
              sampleVideoBlurb: videoBlurbs[0] || null,
              samplePlayerBlurb: playerBlurbs[0] || null,
            });

            // Video bulunanları ekle
            videoBlurbs.forEach(b => {
              const url = b.EREventInfo?.VideoURL || b.VideoURL || b.EREventInfo?.ExternalVideoURL;
              if (url) {
                videos.push({
                  label: b.EREventInfo?.Title || b.BlurbType || 'Höjdpunkt',
                  url,
                  date: ps.matches?.game_date,
                  gameId,
                });
              }
            });
          } catch(e) {
            debugInfo.matchResults.push({ gameId, error: e.message });
          }
        }
      }

      return res.status(200).json({ videos, teamPlayerID, debug: debugInfo });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: 'Ogiltig åtgärd' });
};
