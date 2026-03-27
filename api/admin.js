const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'sfk2026gizliAnahtar!';
const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';

// Forma numarasından PlayerID bul
const SHIRT_TO_PLAYER_ID = {};
// Bu aşağıda SFK_PLAYERS tanımlandıktan sonra doldurulacak

const SFK_PLAYER_IDS = new Set([
  583483,562656,659792,571649,572299,597435,700142,595639,
  571652,558820,571659,589844,572290,572006,595633,606521,
  700147,576573,571068,595628,573259
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
  595628:{name:'Valter Ekehov',shirt:66},
  573259:{name:'Love Nytén',shirt:77},
};

// Forma no → PlayerID eşleştirmesi
Object.keys(SFK_PLAYERS).forEach(pid => {
  SHIRT_TO_PLAYER_ID[SFK_PLAYERS[pid].shirt] = parseInt(pid);
});

const LEAGUES = [
  {id:59554, type:'lig',      team:457347, label:'P16 Div.1 2025'},
  {id:68703, type:'kupa',     team:398871, label:'P16 Ligacupen Grupp 3 2026'},
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
  return new Promise((resolve, reject) => {
    const bodyStr = (body && method !== 'DELETE') ? JSON.stringify(body) : '';
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request({
      host: url.host,
      path: `/rest/v1${path}`,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', (e) => { console.error('supabaseRequest error:', e); resolve(null); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
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
  if (!result.AccessToken) throw new Error('MinFotboll-token kunde inte hämtas');
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
  if (!user) return res.status(401).json({ error: 'Vänligen logga in' });
  const action = req.query.action;

  // savedmatches tüm roller için açık (lig listesi için)
  if (action !== 'savedmatches' && action !== 'getrooms' && action !== 'deleteroom' && user.role !== 'admin' && user.role !== 'antrenor') return res.status(403).json({ error: 'Behörighet krävs' });

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
            homeLogo: g.HomeTeamClubLogoURL || '',
            awayLogo: g.AwayTeamClubLogoURL || '',
            homeTeamId: g.HomeTeamID,
            awayTeamId: g.AwayTeamID,
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
    if (!gameId) return res.status(400).json({ error: 'gameId krävs' });

    const mfToken = await getMinfotbollToken();
    const tid = parseInt(teamId);

    const [overview, lineups, header, rosterData, timelineData] = await Promise.all([
      minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken),
      minfotbollGet(`/api/magazinegameviewapi/initgamelineups?GameID=${gameId}`, mfToken),
      minfotbollGet(`/api/gameapi/getgameheaderinfo?id=${gameId}`, mfToken),
      minfotbollGet(`/api/followgameapi/initlivetimelineblurbs?GameID=${gameId}`, mfToken),
      minfotbollGet(`/api/followgameapi/initlivetimelineblurbs?GameID=${gameId}`, mfToken),
    ]);

    // Rapportörleri bul - her iki takımın TeamStaff'ından MemberID → isim
    const memberMap = {};
    [lineups.HomeTeamGameTeamRoster, lineups.AwayTeamGameTeamRoster].forEach(roster => {
      if (roster?.TeamStaff) {
        roster.TeamStaff.forEach(s => {
          memberMap[s.MemberID] = { name: s.FullName, teamId: roster.TeamID };
        });
      }
    });

    // Timeline'daki olayları rapportöre göre grupla
    const reporterEvents = {}; // memberID -> [EREventID]
    if (rosterData?.TimelineBlurbs) {
      rosterData.TimelineBlurbs.forEach(b => {
        if (b.EREventInfo && b.InsertMemberID) {
          if (!reporterEvents[b.InsertMemberID]) reporterEvents[b.InsertMemberID] = new Set();
          reporterEvents[b.InsertMemberID].add(b.EREventInfo.EREventID);
        }
      });
    }

    // Birden fazla SFK rapportörü var mı?
    const sfkReporters = Object.entries(reporterEvents)
      .filter(([mid]) => memberMap[mid]?.teamId === tid)
      .map(([mid, events]) => ({
        memberId: parseInt(mid),
        name: memberMap[mid]?.name || `ID: ${mid}`,
        eventCount: events.size,
      }));

    // Seçili rapportör varsa filtrele
    const selectedReporterId = req.query.reporterId ? parseInt(req.query.reporterId) : null;

    const isHome = header.HomeTeamID === tid;
    const lineupTeam = isHome ? lineups.HomeTeamLineUp : lineups.AwayTeamLineUp;
    const rosterTeam = isHome ? lineups.HomeTeamGameTeamRoster : lineups.AwayTeamGameTeamRoster;

    // findPlayer - forma numarası veya isimle oyuncu bul
    const findPlayer = (nameOrShirt) => {
      const s = String(nameOrShirt).trim();
      const shirtNum = parseInt(s.split(' ')[0]);
      if (!isNaN(shirtNum) && SHIRT_TO_PLAYER_ID[shirtNum]) return SHIRT_TO_PLAYER_ID[shirtNum];
      const nl = s.toLowerCase();
      return parseInt(Object.keys(SFK_PLAYERS).find(id => {
        const full = SFK_PLAYERS[id].name.toLowerCase();
        const lastName = full.split(' ').pop();
        return full === nl || full.includes(nl) || nl.includes(full) || lastName === nl;
      }));
    };

    // ADIM 1: ROSTER — Kadroya çağrılan tüm SFK oyuncuları
    const playerThumbnails = {};
    const playerShirtNos = {};
    const playerIsStarter = {};
    const playerIsInSquad = {};
    const playerPositions = {};
    const squadPlayerIds = new Set();
    const unknownRosterPlayers = []; // Listede olmayan oyuncular

    if (rosterTeam && rosterTeam.Players) {
      rosterTeam.Players.forEach(p => {
        if (!SFK_PLAYER_IDS.has(p.PlayerID)) {
          // Listede olmayan oyuncu — ambiguous olarak sor
          if (p.FirstName || p.LastName || p.ShirtNumber) {
            unknownRosterPlayers.push({
              type: 'unknownPlayer',
              rawName: `${p.ShirtNumber ? p.ShirtNumber + '. ' : ''}${p.FirstName || ''} ${p.LastName || ''}`.trim(),
              originalPlayerID: p.PlayerID,
              shirtNumber: p.ShirtNumber,
              minute: null,
              description: 'Kadroda ama listede yok'
            });
          }
          return;
        }
        squadPlayerIds.add(p.PlayerID);
        playerIsInSquad[p.PlayerID] = true;
        playerIsStarter[p.PlayerID] = false;
        playerShirtNos[p.PlayerID] = p.ShirtNumber || SFK_PLAYERS[p.PlayerID]?.shirt || 0;
        playerThumbnails[p.PlayerID] = p.ThumbnailURL || null;
      });
    }

    // ADIM 2: LINEUP — İlk 11'i işaretle
    if (lineupTeam && lineupTeam.GameLineUpPlayers) {
      lineupTeam.GameLineUpPlayers.forEach(p => {
        if (!SFK_PLAYER_IDS.has(p.PlayerID)) return;
        squadPlayerIds.add(p.PlayerID);
        playerIsInSquad[p.PlayerID] = true;
        playerIsStarter[p.PlayerID] = true;
        playerPositions[p.PlayerID] = p.Position || '';
        playerShirtNos[p.PlayerID] = playerShirtNos[p.PlayerID] || p.ShirtNumber || SFK_PLAYERS[p.PlayerID]?.shirt || 0;
        playerThumbnails[p.PlayerID] = playerThumbnails[p.PlayerID] || p.ThumbnailURL || null;
      });
    }

    // ADIM 3: DEĞİŞİKLİKLER — Kim girdi/çıktı, hangi dakikada
    const substitutions = {};
    const defaultDur = 90;

    // Değişiklikleri işlemeden önce duplicate'leri temizle ve SIRALA
    const seenSubs = new Set();
    const uniqueSubBlurbs = [];
    if (overview && overview.Blurbs) {
      overview.Blurbs.forEach(b => {
        if (b.TypeID !== 4) return;
        const isOurTeam = isHome ? !b.IsAwayTeamAction : b.IsAwayTeamAction;
        if (!isOurTeam) return;
        const sec = b.GameClockSecond || 0;
        const roundedSec = Math.round(sec / 5) * 5;
        const key = `${b.Title}|${b.Description}|${roundedSec}`;
        if (!seenSubs.has(key)) {
          seenSubs.add(key);
          uniqueSubBlurbs.push(b);
        }
      });
    }

    // Kronolojik sıraya koy - önce erken dakikalar işlensin
    uniqueSubBlurbs.sort((a, b) => (a.GameClockSecond || 0) - (b.GameClockSecond || 0));

    uniqueSubBlurbs.forEach(b => {
      const clockSec = b.GameClockSecond || 0;
      const minute = Math.ceil(clockSec / 60);
      const inName = b.Title ? b.Title.replace(/^\d+\.\s*/, '').trim() : null;
      const outRaw = b.Description ? b.Description.replace(/^Out\s+/i, '').replace(/^\d+\.\s*/, '').trim() : null;
      const inPid = inName ? findPlayer(inName) : null;
      const outPid = outRaw ? findPlayer(outRaw) : null;
      if (inPid && SFK_PLAYER_IDS.has(inPid)) {
        squadPlayerIds.add(inPid);
        if (!substitutions[inPid]) substitutions[inPid] = [];
        substitutions[inPid].push({ inAt: minute, outAt: null });
      }
      if (outPid && SFK_PLAYER_IDS.has(outPid)) {
        if (!substitutions[outPid]) substitutions[outPid] = [];
        const arr = substitutions[outPid];
        let last = null;
        for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].outAt === null) { last = arr[i]; break; } }
        if (last) last.outAt = minute;
        else substitutions[outPid].push({ inAt: 0, outAt: minute });
      }
    });

    // Dakika hesabı
    const calcMinutes = (pidNum, isStarter, gameDur) => {
      const subs = substitutions[pidNum] || [];
      if (isStarter) {
        const outSub = subs.find(s => s.inAt === 0 && s.outAt !== null);
        if (outSub) {
          let total = outSub.outAt;
          subs.filter(s => s.inAt > 0).forEach(s => total += (s.outAt || gameDur) - s.inAt);
          return total;
        }
        return gameDur;
      } else {
        if (subs.length === 0) return 0; // Kadroda ama oyuna girmedi
        let total = 0;
        subs.forEach(s => total += (s.outAt || gameDur) - s.inAt);
        return total;
      }
    };

    // ADIM 4: OLAYLAR — Gol, asist, kart
    const events = { goals:{}, assists:{}, yellowCards:{}, redCards:{} };
    const ambiguous = [...unknownRosterPlayers]; // Listede olmayan kadro oyuncuları

    // Rapportör filtresi - sadece manuel seçimde uygula
    let effectiveReporterId = selectedReporterId;
    let allowedEventIds = null;
    if (effectiveReporterId && reporterEvents[effectiveReporterId]) {
      allowedEventIds = reporterEvents[effectiveReporterId];
    }

    // Olaylar: SFK rapportörü varsa onun olaylarını al
    // SFK rapportörünün olmadığı tip+oyuncu kombinasyonları için diğer rapportörden tamamla
    const seenEvents = new Set(); // işlenen olaylar (tip+oyuncu key)
    const sfkRepEventIds = sfkReporters.length > 0 && reporterEvents[sfkReporters[0]?.memberId]
      ? reporterEvents[sfkReporters[0].memberId] : null;

    // SFK rapportörünün hangi tip+oyuncu kombinasyonlarını kapsadığını bul
    const sfkCoveredKeys = new Set();
    if (sfkRepEventIds && overview?.Blurbs) {
      overview.Blurbs.forEach(b => {
        if (sfkRepEventIds.has(b.ItemID)) {
          const key = `${b.TypeID}|${b.Title}`;
          sfkCoveredKeys.add(key);
        }
      });
    }

    if (overview && overview.Blurbs) {
      // SFK rapportörünün olayları önce, diğerleri sonra
      const sortedBlurbs = [...overview.Blurbs].sort((a, b) => {
        const aIsSfk = sfkRepEventIds?.has(a.ItemID) ? 0 : 1;
        const bIsSfk = sfkRepEventIds?.has(b.ItemID) ? 0 : 1;
        return aIsSfk - bIsSfk;
      });
      sortedBlurbs.forEach(b => {
        if (allowedEventIds && b.ItemID && !allowedEventIds.has(b.ItemID)) return;
        // SFK rapportörü bu tip+oyuncuyu kapsamışsa, başkasından geleni reddet
        const coverKey = `${b.TypeID}|${b.Title}`;
        if (sfkRepEventIds && sfkCoveredKeys.has(coverKey) && !sfkRepEventIds.has(b.ItemID)) return;
        const isOurTeam = isHome ? !b.IsAwayTeamAction : b.IsAwayTeamAction;
        if (!isOurTeam) return;
        // Duplicate kontrolü - her zaman uygula
        const eventKey = `${b.TypeID}|${b.Title}|${b.GameMinute}`;
        if (seenEvents.has(eventKey)) return;
        seenEvents.add(eventKey);
        const playerName = b.Title ? b.Title.replace(/^\d+\.\s*/, '').trim() : null;
        if (!playerName) return;
        const pid = findPlayer(playerName);
        if (b.TypeID === 1 && b.IsGoal) {
          if (pid) events.goals[pid] = (events.goals[pid] || 0) + 1;
          else ambiguous.push({ type: 'goal', rawName: playerName, minute: b.GameMinute, description: b.Description });
          const assistPrefix = b.Description && (b.Description.includes('Assist av:') ? 'Assist av:' : b.Description.includes('Assist by:') ? 'Assist by:' : null);
          if (assistPrefix) {
            const assistName = b.Description.replace(assistPrefix, '').trim().replace(/^\d+\.\s*/, '').trim();
            const apid = findPlayer(assistName);
            if (apid) events.assists[apid] = (events.assists[apid] || 0) + 1;
            else ambiguous.push({ type: 'assist', rawName: assistName, minute: b.GameMinute, description: b.Description });
          }
        } else if (b.TypeID === 6) {
          if (pid) events.yellowCards[pid] = (events.yellowCards[pid] || 0) + 1;
          else ambiguous.push({ type: 'yellowCard', rawName: playerName, minute: b.GameMinute, description: b.Description });
        } else if (b.TypeID === 7) {
          if (pid) events.redCards[pid] = (events.redCards[pid] || 0) + 1;
          else ambiguous.push({ type: 'redCard', rawName: playerName, minute: b.GameMinute, description: b.Description });
        }
      });
    }

    // TÜM KADRO — roster + lineup + değişiklikle giren oyuncular
    const players = [...squadPlayerIds].map(pidNum => {
      const isStarter = playerIsStarter[pidNum] === true;
      const minutesPlayed = calcMinutes(pidNum, isStarter, defaultDur);
      const playedInMatch = isStarter || (substitutions[pidNum] && substitutions[pidNum].length > 0);
      return {
        playerId: pidNum,
        name: SFK_PLAYERS[pidNum].name,
        shirt: playerShirtNos[pidNum] || SFK_PLAYERS[pidNum].shirt,
        thumbnail: playerThumbnails[pidNum] || null,
        position: playerPositions[pidNum] || '',
        isGoalkeeper: (playerPositions[pidNum] || '').includes('Goalkeeper'),
        isStarter,
        isInSquad: true,
        playedInMatch,
        played: true,
        selected: true,
        minutesPlayed,
        goals: events.goals[pidNum] || 0,
        assists: events.assists[pidNum] || 0,
        yellowCards: events.yellowCards[pidNum] || 0,
        redCards: events.redCards[pidNum] || 0,
      };
    }).sort((a,b) => {
      if (a.isGoalkeeper && !b.isGoalkeeper) return -1;
      if (!a.isGoalkeeper && b.isGoalkeeper) return 1;
      if (a.isStarter && !b.isStarter) return -1;
      if (!a.isStarter && b.isStarter) return 1;
      return a.shirt - b.shirt;
    });

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
      ambiguous,
      reporters: sfkReporters,
      selectedReporterId,

    });
  }

  // Maçı onayla ve database'e kaydet
  if (action === 'savematch' && req.method === 'POST') {
    const { gameId, gameDate, homeTeam, awayTeam, homeScore, awayScore,
            leagueName, gameType, players } = req.body || {};

    if (!gameId || !players) return res.status(400).json({ error: 'Information saknas' });
    const gameDuration = req.body.gameDuration || 90;

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
        game_type: gameType, game_duration: parseInt(gameDuration) || 90,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      });
      matchId = Array.isArray(match) ? match[0].id : match.id;
    }

    // Oyuncu istatistiklerini kaydet
    for (const p of players) {
      const existingStat = await supabaseGet(`/player_stats?match_id=eq.${matchId}&player_id=eq.${p.playerId}&select=id`);
      const statData = {
        player_name: p.name,
        shirt_number: p.shirt,
        played: p.played,
        is_starter: p.isStarter || false,
        minutes_played: p.minutesPlayed || 0,
        goals: p.goals || 0,
        assists: p.assists || 0,
        yellow_cards: p.yellowCards || 0,
        red_cards: p.redCards || 0,
        thumbnail: p.thumbnail || null,
      };

      if (Array.isArray(existingStat) && existingStat.length > 0) {
        // Güncelle - DELETE + INSERT (PATCH güvenilir değil)
        const statId = existingStat[0].id;
        await supabaseRequest('DELETE', `/player_stats?id=eq.${statId}`, null);
        await supabaseRequest('POST', '/player_stats', {
          match_id: matchId,
          player_id: p.playerId,
          ...statData,
        });
      } else {
        await supabaseRequest('POST', '/player_stats', {
          match_id: matchId,
          player_id: p.playerId,
          ...statData,
        });
      }
    }

    return res.status(200).json({ success: true, matchId });
  }

  // Kayıtlı maçları listele
  if (action === 'savedmatches') {
    try {
      const matches = await supabaseGet('/matches?select=*&order=game_date.desc');
      if (!Array.isArray(matches)) return res.status(200).json([]);
      if (user.role === 'oyuncu') {
        return res.status(200).json(matches.map(m => ({ league_name: m.league_name })));
      }
      return res.status(200).json(matches);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Soyunma odası atamasını kaydet


  // Soyunma odası atamalarını getir
  if (action === 'getrooms') {
    try {
      const sessionName = req.query.session;
      const from = req.query.from || '';
      const to   = req.query.to   || '';
      if (sessionName) {
        // Belirli bir session'ın kayıtları
        const path = `/room_assignments?session_name=eq.${encodeURIComponent(sessionName)}&select=*&order=game_date.asc`;
        const rooms = await supabaseGet(path);
        return res.status(200).json(Array.isArray(rooms) ? rooms : []);
      }
      // Tüm session bilgilerini getir
      const path = `/room_assignments?select=session_name,game_date,updated_at&order=updated_at.desc`;
      const rows = await supabaseGet(path);
      if (!Array.isArray(rows)) return res.status(200).json({ sessions: [] });
      // Her session için: en son updated_at, min/max game_date
      const sessionMap = {};
      rows.forEach(r => {
        if (!r.session_name) return;
        if (!sessionMap[r.session_name]) {
          sessionMap[r.session_name] = { name: r.session_name, updatedAt: r.updated_at, minDate: r.game_date, maxDate: r.game_date };
        } else {
          const s = sessionMap[r.session_name];
          if (r.updated_at > s.updatedAt) s.updatedAt = r.updated_at;
          if (r.game_date < s.minDate) s.minDate = r.game_date;
          if (r.game_date > s.maxDate) s.maxDate = r.game_date;
        }
      });
      // En son güncellenen önce
      const sessions = Object.values(sessionMap).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
      return res.status(200).json({ sessions });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // Arena/Venue bilgisi - maçtan arena ID'si al
  if (action === 'venueinfo') {
    const gameId = req.query.gameId;
    if (!gameId) return res.status(400).json({ error: 'gameId kravs' });
    try {
      const mfToken = await getMinfotbollToken();
      const overview = await minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken);
      const arena = overview?.Arena || {};
      // getgamedetail'den takım bilgisi çek
      const detail = await minfotbollGet(`/api/getgamedetail?GameID=${gameId}`, mfToken);
      // GameResults içinden takım bilgisi çek
      const results = overview?.GameResults || {};
      const homeTeamId   = results.HomeTeamID || null;
      const awayTeamId   = results.AwayTeamID || null;
      const homeTeamName = results.HomeTeamName || results.HomeTeamDisplayName || null;
      const awayTeamName = results.AwayTeamName || results.AwayTeamDisplayName || null;
      const homeClubId   = results.HomeTeamClubID || null;
      const awayClubId   = results.AwayTeamClubID || null;
      // GameStats'tan da dene
      const stats = overview?.GameStats || {};
      return res.status(200).json({
        arenaId: arena.ArenaID || null,
        arenaName: arena.ArenaName || null,
        latitude: arena.Latitude || null,
        longitude: arena.Longitude || null,
        homeTeamId: detail?.HomeTeamID || null,
        homeTeamName: detail?.HomeTeamDisplayName || null,
        homeClubId: detail?.HomeTeamClubID || null,
        homeClubName: detail?.HomeTeamClubName || null,
        awayTeamId: detail?.AwayTeamID || null,
        awayTeamName: detail?.AwayTeamDisplayName || null,
        awayClubId: detail?.AwayTeamClubID || null,
        awayClubName: detail?.AwayTeamClubName || null,
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Omklädningsrum - tüm SFK arenalarındaki maçlar, tarih aralığına göre
  // Yöntem: ClubID=1917 ile tüm kulüp maçlarını çek, SFK arenalarına göre filtrele
  if (action === 'arenagames') {
    const { dateFrom, dateTo } = req.query;

    // SFK arenalarının MinFotboll ArenaID'leri (doğrulanmış):
    // 21808 = Norrvikens IP 1
    // 21815 = Norrvikens IP 2 Hall
    // 20977 = Sollentuna Fotbollshall 1
    // 20976 = Sollentuna Fotbollshall
    // 20586 = Edsbergs Sportfält
    // 20588 = Edsbergs Sportfält 2
    // 20591 = Edsbergs Sportfält 3
    const SFK_ARENA_IDS = new Set([21808, 21815, 20977, 20976, 20586, 20588, 20591, 21807]);

    const from = dateFrom || new Date().toISOString().slice(0, 10);
    const to   = dateTo   || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    try {
      const mfToken = await getMinfotbollToken();
      const allGames = [];
      const seen = new Set();

      // Kulübün tüm coming maçlarını çek (pagination ile)
      const allClubGames = [];
      let lastGameId = 0;
      let page = 0;
      while (page < 20) { // max 20 sayfa (200 maç)
        const batch = await minfotbollGet(
          `/api/clubapi/getcomingclubgames?ClubID=1917&LastGameID=${lastGameId}`, mfToken
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        allClubGames.push(...batch);
        lastGameId = batch[batch.length - 1].GameID;
        if (batch.length < 10) break; // son sayfa
        page++;
      }

      allClubGames.forEach(g => {
        if (!SFK_ARENA_IDS.has(g.ArenaID)) return;
        if (seen.has(g.GameID)) return;
        const gDate = g.GameTime ? g.GameTime.slice(0, 10) : '';
        if (gDate < from || gDate > to) return;
        seen.add(g.GameID);
        allGames.push({
          gameId    : g.GameID,
          gameDate  : g.GameTime,
          homeTeam  : g.HomeTeamDisplayName,
          awayTeam  : g.AwayTeamDisplayName,
          homeTeamId: g.HomeTeamID || null,
          awayTeamId: g.AwayTeamID || null,
          homeClubId: g.HomeTeamClubID || null,
          awayClubId: g.AwayTeamClubID || null,
          homeLogo  : g.HomeTeamClubLogoURL || null,
          awayLogo  : g.AwayTeamClubLogoURL || null,
          homeScore : g.HomeTeamScore ?? null,
          awayScore : g.AwayTeamScore ?? null,
          arenaId   : g.ArenaID,
          arenaName : g.ArenaName,
          leagueName: g.LeagueName || g.LeagueDisplayName || '—',
          gameType  : getGameType(g.LeagueName || g.LeagueDisplayName || ''),
          statusId  : g.GameStatusID,
        });
      });

      allGames.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
      return res.status(200).json({ count: allGames.length, games: allGames });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DEBUG: Gerçek bir maçın arena bilgisini ve çevre endpoint'leri incele
  if (action === 'debugarena') {
    const from = req.query.from || '2026-04-01';
    const to   = req.query.to   || '2026-06-30';
    try {
      const mfToken = await getMinfotbollToken();
      const results = {};

      // Adım 1: Bilinen bir ligden gerçek maçları çek
      // P16 2026 liginden maç al
      const leagueGames = await minfotbollGet(
        `/api/leagueapi/getleaguegames?leagueId=129362`, mfToken
      );
      const sample = Array.isArray(leagueGames) ? leagueGames.slice(0, 3) : [];
      results['league_sample'] = sample.map(g => ({
        GameID: g.GameID,
        GameTime: g.GameTime,
        Home: g.HomeTeamDisplayName,
        Away: g.AwayTeamDisplayName,
        StatusID: g.GameStatusID,
      }));

      // Adım 2: İlk maçın overview'unu çek — arena bilgisi
      if (sample.length > 0) {
        const gameId = sample[0].GameID;
        const overview = await minfotbollGet(
          `/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken
        );
        results['overview_arena'] = overview?.Arena || 'No Arena field';
        results['overview_keys'] = overview ? Object.keys(overview) : [];

        // Adım 3: getgameheaderinfo — arena var mı?
        const header = await minfotbollGet(
          `/api/gameapi/getgameheaderinfo?id=${gameId}`, mfToken
        );
        results['header_keys'] = header ? Object.keys(header) : [];
        results['header_arena'] = header?.Arena || header?.ArenaID || header?.Facility || 'none';
        results['header_sample'] = header;
      }

      // Adım 4: Farklı tarih formatlarıyla dene
      const arenaId = '21808';
      const formatTests = [
        `/api/leagueapi/getleaguegamesbyfacility?facilityId=${arenaId}&fromDate=${from}&toDate=${to}`,
        `/api/leagueapi/getgamesbyfacility?facilityId=${arenaId}&fromDate=${from}&toDate=${to}`,
        `/api/gameresultapi/getresults?facilityId=${arenaId}&fromDate=${from}&toDate=${to}`,
        `/api/gameresultapi/getresults?ArenaID=${arenaId}&DateFrom=${from}&DateTo=${to}`,
        `/api/gameapi/getgames?facilityId=${arenaId}&fromDate=${from}&toDate=${to}`,
        `/api/matchapi/getmatchesbyfacility?facilityId=${arenaId}&fromDate=${from}&toDate=${to}`,
      ];
      for (const ep of formatTests) {
        try {
          const r = await minfotbollGet(ep, mfToken);
          const isArr = Array.isArray(r);
          const len = isArr ? r.length : (r && typeof r === 'object' ? Object.keys(r).length : -1);
          if (len > 0) {
            results[ep] = { HIT: true, isArray: isArr, length: len, sample: isArr ? r[0] : r };
          } else {
            results[ep] = { empty: true, type: typeof r };
          }
        } catch(e) {
          results[ep] = { error: e.message };
        }
      }

      return res.status(200).json(results);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }


  // SFK kadro listesi - oyuncular + staff
  if (action === 'sfkroster') {
    try {
      const mfToken = await getMinfotbollToken();
      const results = [];

      // Her iki takımın oyuncularını çek
      for (const teamId of [398871, 74782]) {
        const teamLabel = teamId === 398871 ? 'P16' : 'P17';
        const players = await minfotbollGet(`/api/teamapi/initplayersadminvc?TeamID=${teamId}`, mfToken);
        if (Array.isArray(players)) {
          players.forEach(p => {
            results.push({
              type: 'player',
              memberId: p.MemberID,
              playerId: p.PlayerID,
              name: p.FullName || `${p.FirstName} ${p.LastName}`,
              shirt: p.ShirtNumber,
              team: teamLabel,
              thumbnail: p.ThumbnailURL || null,
            });
          });
        }
      }

      // Son maçlardan staff listesini çek
      const matches = await supabaseGet('/matches?select=game_id&order=game_date.desc&limit=3');
      const seenMembers = new Set();
      if (Array.isArray(matches)) {
        for (const match of matches) {
          const lineups = await minfotbollGet(`/api/magazinegameviewapi/initgamelineups?GameID=${match.game_id}`, mfToken);
          for (const roster of [lineups?.HomeTeamGameTeamRoster, lineups?.AwayTeamGameTeamRoster]) {
            if (!roster?.TeamStaff) continue;
            if (roster.TeamID !== 398871 && roster.TeamID !== 74782) continue;
            roster.TeamStaff.forEach(s => {
              if (seenMembers.has(s.MemberID)) return;
              seenMembers.add(s.MemberID);
              results.push({
                type: 'staff',
                memberId: s.MemberID,
                playerId: null,
                name: s.FullName,
                role: s.TeamStaffRoleName,
                team: roster.TeamID === 398871 ? 'P16' : 'P17',
                thumbnail: s.ThumbnailURL || null,
              });
            });
          }
        }
      }

      return res.status(200).json(results.sort((a,b) => a.name.localeCompare(b.name, 'sv')));
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
if (action === 'clubgames') {
    try {
      const mfToken = await getMinfotbollToken();
      const clubId = req.query.clubId || '1917';
      // Tüm coming maçları pagination ile çek
      const allGamesForTeams = [];
      let lastId = 0;
      for (let p = 0; p < 20; p++) {
        const batch = await minfotbollGet(`/api/clubapi/getcomingclubgames?ClubID=${clubId}&LastGameID=${lastId}`, mfToken);
        if (!Array.isArray(batch) || batch.length === 0) break;
        allGamesForTeams.push(...batch);
        lastId = batch[batch.length - 1].GameID;
        if (batch.length < 10) break;
      }
      const teams = {};
      allGamesForTeams.forEach(g => {
        if (g.HomeTeamClubID === parseInt(clubId) || g.HomeTeamClubName?.toLowerCase().includes('sollentuna')) {
          teams[g.HomeTeamID] = g.HomeTeamDisplayName;
        }
        if (g.AwayTeamClubID === parseInt(clubId) || g.AwayTeamClubName?.toLowerCase().includes('sollentuna')) {
          teams[g.AwayTeamID] = g.AwayTeamDisplayName;
        }
      });
      return res.status(200).json({
        comingCount: allGamesForTeams.length,
        sfkTeams: teams,
        comingSample: allGamesForTeams.slice(0, 2),
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'rawgame') {
    try {
      const mfToken = await getMinfotbollToken();
      const leagueId = req.query.leagueId || '59554';
      const games = await minfotbollGet('/api/leagueapi/getleaguegames?leagueId=' + leagueId, mfToken);
      if (!Array.isArray(games) || games.length === 0) return res.status(200).json({ count: 0 });
      // SFK olan ilk maçı bul
      const sfk = games.find(g =>
        g.HomeTeamClubName?.toLowerCase().includes('sollentuna') ||
        g.AwayTeamClubName?.toLowerCase().includes('sollentuna')
      );
      return res.status(200).json({ raw: sfk || games[0] });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'playerraw') {
    try {
      const mfToken = await getMinfotbollToken();
      const playerId = parseInt(req.query.playerId || '597435');
      const roster = await minfotbollGet(`/api/teamapi/initplayersadminvc?TeamID=398871`, mfToken);
      const player = Array.isArray(roster) ? roster.find(p => p.PlayerID === playerId) : null;
      // Ayrıca member endpoint dene
      // Farklı endpointler dene
      let memberData = null;
      const memberId = player?.MemberID;
      const endpoints = [
        `/api/memberapi/getmember?MemberID=${memberId}`,
        `/api/memberapi/getmemberprofile?MemberID=${memberId}`,
        `/api/teamapi/getteamplayer?TeamPlayerID=${player?.TeamPlayerID}`,
        `/api/magazinegameviewapi/getplayerprofile?PlayerID=${playerId}`,
      ];
      for (const ep of endpoints) {
        try {
          const r = await minfotbollGet(ep, mfToken);
          if (r && typeof r === 'object' && !Array.isArray(r)) {
            memberData = { endpoint: ep, keys: Object.keys(r), data: r };
            break;
          }
        } catch(e) {}
      }
      return res.status(200).json({
        playerKeys: player ? Object.keys(player) : [],
        playerRaw: player,
        memberData,
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (action === 'testleague') {
    try {
      const mfToken = await getMinfotbollToken();
      const leagueId = req.query.leagueId || '59554';
      const teamId   = parseInt(req.query.teamId || '398871');
      const games    = await minfotbollGet('/api/leagueapi/getleaguegames?leagueId=' + leagueId, mfToken);
      if (!Array.isArray(games) || games.length === 0) {
        return res.status(200).json({ count: 0, raw: typeof games === 'string' ? games.slice(0,200) : games });
      }
      // teamId=0 -> debug: ligdeki tum takimlari listele
      if (teamId === 0) {
        const teams = {};
        games.forEach(g => {
          teams[g.HomeTeamID] = g.HomeTeamDisplayName;
          teams[g.AwayTeamID] = g.AwayTeamDisplayName;
        });
        // Sollentuna iceren takim isimlerini ayir
        const sfkTeams = Object.entries(teams)
          .filter(([id, name]) => name && name.toLowerCase().includes('sollentuna'))
          .reduce((acc, [id, name]) => { acc[id] = name; return acc; }, {});
        // ClubID'leri de topla
        const clubs = {};
        games.forEach(g => {
          clubs[g.HomeTeamClubID] = g.HomeTeamClubName;
          clubs[g.AwayTeamClubID] = g.AwayTeamClubName;
        });
        const sfkClubs = Object.entries(clubs)
          .filter(([id, name]) => name && name.toLowerCase().includes('sollentuna'))
          .reduce((acc, [id, name]) => { acc[id] = name; return acc; }, {});
        return res.status(200).json({ count: games.length, sfkTeams, sfkClubs, allTeams: teams, allClubs: clubs });
      }

      // Sadece ev macları
      const homeGames = games
        .filter(g => g.HomeTeamID === teamId)
        .map(g => ({
          GameID   : g.GameID,
          GameTime : g.GameTime,
          Home     : g.HomeTeamDisplayName,
          Away     : g.AwayTeamDisplayName,
          ArenaID  : g.ArenaID,
          ArenaName: g.ArenaName,
          StatusID : g.GameStatusID,
        }));
      // Ligdeki tüm benzersiz ArenaID'ler
      const arenaIds     = [...new Set(games.map(g => g.ArenaID).filter(Boolean))];
      const facilityIds  = [...new Set(games.map(g => g.FacilityID).filter(Boolean))];
      return res.status(200).json({
        count      : games.length,
        allKeys    : Object.keys(games[0]),
        hasArenaID : 'ArenaID' in games[0],
        hasFacilityID: 'FacilityID' in games[0],
        arenaIds,
        facilityIds,
        homeGames,
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }


  // Tek oda atamasını kaydet/güncelle
  if (action === 'saveroom') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    try {
      const { game_id, game_date, home_team, away_team, arena_id, arena_name,
              home_room, away_room, notes, status, extra_json,
              home_logo, away_logo, session_name } = req.body;
      const gameIdVal = game_id || req.body.gameId;
      if (!gameIdVal) return res.status(400).json({ error: 'game_id required' });
      const row = {
        game_id: gameIdVal, game_date, home_team, away_team, arena_id, arena_name,
        home_room: home_room || null, away_room: away_room || null,
        notes: notes || null, status: status || 'pending',
        extra_json: extra_json || null,
        home_logo: home_logo || null, away_logo: away_logo || null,
        session_name: session_name || null,
        updated_at: new Date().toISOString()
      };
      let result;
      if (session_name) {
        const existing = await supabaseGet(
          `/room_assignments?game_id=eq.${gameIdVal}&session_name=eq.${encodeURIComponent(session_name)}`
        );
        if (Array.isArray(existing) && existing.length > 0) {
          result = await supabaseRequest('PATCH',
            `/room_assignments?game_id=eq.${gameIdVal}&session_name=eq.${encodeURIComponent(session_name)}`, row);
        } else {
          result = await supabaseRequest('POST', '/room_assignments', row);
        }
      } else {
        const existing = await supabaseGet(`/room_assignments?game_id=eq.${gameIdVal}&session_name=is.null`);
        if (Array.isArray(existing) && existing.length > 0) {
          result = await supabaseRequest('PATCH',
            `/room_assignments?game_id=eq.${gameIdVal}&session_name=is.null`, row);
        } else {
          result = await supabaseRequest('POST', '/room_assignments', row);
        }
      }
      return res.status(200).json({ ok: true, result });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // Oda atamasını sil
  if (action === 'deleteroom') {
    try {
      const gameId     = req.query.gameId;
      const sessionDel = req.query.session;
      if (sessionDel) {
        // Tüm session'ı sil
        await supabaseRequest('DELETE', `/room_assignments?session_name=eq.${encodeURIComponent(sessionDel)}`, null);
        return res.status(200).json({ ok: true, deleted: 'session' });
      }
      if (!gameId) return res.status(400).json({ error: 'gameId required' });
      await supabaseRequest('DELETE', `/room_assignments?game_id=eq.${gameId}`, null);
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // Onay durumunu güncelle
  if (action === 'approveroom') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    try {
      const { game_id, status } = req.body; // status: 'approved' | 'pending' | 'rejected'
      if (!game_id) return res.status(400).json({ error: 'game_id required' });
      const result = await supabaseRequest('PATCH', `/room_assignments?game_id=eq.${game_id}`,
        { status, updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, result });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  res.status(400).json({ error: 'Ogiltig åtgärd' });
};

// deploy trigger Wed Mar 25 13:32:45 UTC 2026
