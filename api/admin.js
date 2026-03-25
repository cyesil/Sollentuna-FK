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
  {id:59554, type:'lig',      team:398871, label:'P16 Div.1 2025'},
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
  if (action !== 'savedmatches' && user.role !== 'admin' && user.role !== 'antrenor') return res.status(403).json({ error: 'Behörighet krävs' });

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
  if (action === 'saveroom') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST gerekli' });
    let body = '';
    await new Promise(resolve => { req.on('data', c => body += c); req.on('end', resolve); });
    const { gameId, homeRoom, awayRoom } = JSON.parse(body);
    if (!gameId) return res.status(400).json({ error: 'gameId krävs' });

    // Upsert - game_id unique
    const existing = await supabaseGet(`/room_assignments?game_id=eq.${gameId}&select=id`);
    const url = new URL(SUPABASE_URL);
    const rowData = { game_id: gameId, home_room: homeRoom || null, away_room: awayRoom || null };

    if (Array.isArray(existing) && existing.length > 0) {
      // Update
      await new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(rowData);
        const req2 = require('https').request({
          host: url.host, path: `/rest/v1/room_assignments?game_id=eq.${gameId}`,
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(bodyStr) }
        }, res2 => { res2.on('data',()=>{}); res2.on('end', resolve); });
        req2.on('error', reject); req2.write(bodyStr); req2.end();
      });
    } else {
      // Insert
      await new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(rowData);
        const req2 = require('https').request({
          host: url.host, path: `/rest/v1/room_assignments`,
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(bodyStr) }
        }, res2 => { res2.on('data',()=>{}); res2.on('end', resolve); });
        req2.on('error', reject); req2.write(bodyStr); req2.end();
      });
    }
    return res.status(200).json({ success: true });
  }

  // Soyunma odası atamalarını getir
  if (action === 'getrooms') {
    const rooms = await supabaseGet('/room_assignments?select=*');
    return res.status(200).json(Array.isArray(rooms) ? rooms : []);
  }

  // Arena/Venue bilgisi - maçtan arena ID'si al
  if (action === 'venueinfo') {
    const gameId = req.query.gameId;
    if (!gameId) return res.status(400).json({ error: 'gameId kravs' });
    try {
      const mfToken = await getMinfotbollToken();
      const overview = await minfotbollGet(`/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken);
      const arena = overview?.Arena || {};
      return res.status(200).json({
        arenaId: arena.ArenaID || null,
        arenaName: arena.ArenaName || null,
        latitude: arena.Latitude || null,
        longitude: arena.Longitude || null,
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Omklädningsrum - tüm SFK arenalarındaki maçlar, tarih aralığına göre
  if (action === 'arenagames') {
    const { dateFrom, dateTo, arenaId: reqArenaId } = req.query;

    const SFK_ARENAS = {
      21808: 'Norrvikens IP 1',
      21815: 'Norrvikens IP 2 Hall',
      20977: 'Sollentuna Fotbollshall',
      20586: 'Edsbergs Sportfält',
      20588: 'Edsbergs Sportfält 2',
      20591: 'Edsbergs Sportfält 3',
    };

    const FOGIS_API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';
    const FOGIS_HOST    = 'forening-api.svenskfotboll.se';

    function fogisApiGet(path) {
      return new Promise((resolve, reject) => {
        const fullPath = path.startsWith('/') ? path : '/' + path;
        const req2 = require('https').request({
          host: FOGIS_HOST,
          path: fullPath,
          method: 'GET',
          headers: {
            'ApiKey': FOGIS_API_KEY,
            'Accept': 'application/json',
            'User-Agent': 'SFK-App/1.0'
          }
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
          });
        });
        req2.on('error', reject);
        req2.setTimeout(20000, () => { req2.destroy(); reject(new Error('timeout')); });
        req2.end();
      });
    }

    const arenasToQuery = reqArenaId
      ? { [reqArenaId]: SFK_ARENAS[reqArenaId] || 'Arena ' + reqArenaId }
      : SFK_ARENAS;

    const from = dateFrom || new Date().toISOString().slice(0, 10);
    const to   = dateTo   || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    try {
      const allGames = [];
      const seen = new Set();

      // FOGIS Förening API — her arena için maçları çek
      // Endpoint: /club/matches?facilityId=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD
      const arenaEntries = Object.entries(arenasToQuery);

      await Promise.all(arenaEntries.map(async ([arenaIdStr, arenaName]) => {
        const arenaIdNum = parseInt(arenaIdStr);

        // Denenecek endpoint kombinasyonları
        const endpoints = [
          `/matches?facilityId=${arenaIdNum}&from=${from}&to=${to}`,
          `/club/matches?facilityId=${arenaIdNum}&from=${from}&to=${to}`,
          `/matchresults?facilityId=${arenaIdNum}&fromDate=${from}&toDate=${to}`,
          `/club/matchresults?facilityId=${arenaIdNum}&fromDate=${from}&toDate=${to}`,
          `/games?arenaId=${arenaIdNum}&dateFrom=${from}&dateTo=${to}`,
          `/club/games?arenaId=${arenaIdNum}&dateFrom=${from}&dateTo=${to}`,
        ];

        let games = null;
        for (const ep of endpoints) {
          try {
            const result = await fogisApiGet(ep);
            if (Array.isArray(result) && result.length > 0) { games = result; break; }
            if (result && Array.isArray(result.matches) && result.matches.length > 0) { games = result.matches; break; }
            if (result && Array.isArray(result.games) && result.games.length > 0) { games = result.games; break; }
          } catch(e) {}
        }

        // FOGIS çalıştıysa ekle
        if (Array.isArray(games)) {
          games.forEach(g => {
            const gameId = g.matchId || g.id || g.GameId || g.gameId || g.MatchId;
            if (!gameId || seen.has(gameId)) return;
            seen.add(gameId);
            const homeTeam = g.homeTeamName || (g.homeTeam && (g.homeTeam.teamName || g.homeTeam.name)) || g.HomeTeamName || '—';
            const awayTeam = g.awayTeamName || (g.awayTeam && (g.awayTeam.teamName || g.awayTeam.name)) || g.AwayTeamName || '—';
            const league   = g.competitionName || g.leagueName || g.seriesName || g.CompetitionName || '—';
            allGames.push({
              gameId, gameDate: g.startTime || g.matchDate || g.date || g.GameTime,
              homeTeam, awayTeam,
              homeScore: g.homeGoals ?? g.HomeGoals ?? null,
              awayScore: g.awayGoals ?? g.AwayGoals ?? null,
              arenaId: arenaIdNum, arenaName,
              leagueName: league, gameType: getGameType(league),
            });
          });
        }
      }));

      // FOGIS çalışmadıysa — MinFotboll'dan tüm SFK takımlarının maçlarını çek + arena filtresi
      if (allGames.length === 0) {
        const mfToken = await getMinfotbollToken();
        const fromDate = new Date(from);
        const toDate   = new Date(to + 'T23:59:59');

        // takim.txt'deki tüm takım ID'lerini kapsayan geniş liste
        // Aktif sezon 2026 + 2025 takımları dahil
        const ALL_SFK_TEAM_IDS = [
          245984, 151108, 303423, 233248, 212391, 318812, 303424, 342453,
          287010, 318035, 263767, 291602, 278298,
          // 2025
          345555, 345556, 345557, 345559, 345560, 345561, 345562, 345563,
          345565, 345566, 345567, 345568, 345569, 345570, 345571, 345575,
          345578, 345580, 345586, 345594, 345595, 345596, 345598, 345600,
          345602, 345603, 345604, 345605, 345606, 345609, 345610, 345612,
          345615, 345617, 345627, 345628, 345629, 345639, 345640, 345641,
          348052, 348053, 348055, 348056, 348057, 348059, 348061, 348062, 348063,
          // 2026
          353493, 354394, 354393, 354497, 354499, 354502, 354504, 354507,
          354516, 354519, 354524, 354528, 354532, 354533, 354535, 354538,
          354540, 354557, 354746, 354747, 354748, 354751, 354753, 354756,
          354759, 354766, 354767, 354771, 354775, 354776, 354778, 354784,
          354785, 354788, 354790, 354792, 354795, 354796, 354797, 354803,
          354804, 354805, 354808, 354809, 354810, 354811, 354812, 354813,
          354863, 354877, 354885, 354886, 354887, 354889, 354890, 354894,
          354898, 354899, 354906, 354908, 354910, 354914, 354920, 354922,
          354923, 354926, 354930, 354934, 354937, 354940, 354943, 354957,
          354960, 354961, 354963, 354967, 354970, 354972, 354982, 354984,
          354986, 354991, 354996,
          366073, 366074, 366498, 366637, 366640, 366643, 366644, 366645,
          366646, 366647, 366648, 366916, 366917,
          367665, 367666, 367669, 367670, 367672, 367673, 367676, 367677,
          367678, 367679, 367680, 367685, 367687, 367694, 367695, 367697,
          367700, 367703, 367704, 367708, 367709, 367713, 367717, 367722,
          367726, 367727, 367728, 367730, 367731, 367733,
          371423, 371424, 371427, 371428, 371432, 371433,
          372401, 374769, 374800,
          376963, 376964, 376965, 376970, 376973, 376975, 376976,
          376983, 376984, 376985, 376986, 376988,
          377009, 377012, 377013, 377015, 377023, 377026, 377029,
          377035, 377047, 377050, 377054, 377080, 377085, 377087, 377088,
          377089, 377090, 377091, 377093, 377095, 377097, 377099, 377101,
          377103, 377104, 377105, 377107, 377108, 377109, 377111, 377113,
          377114, 377115, 377116, 377118, 377119, 377120, 377121, 377122,
          377123, 377124, 377125, 377126, 377127, 377131, 377133, 377134,
          377139, 377140, 377143, 377152, 377153, 377158, 377160, 377165,
          377166, 377167, 377173, 377174, 377176, 377177, 377178, 377180,
          377181, 377182, 377188, 377191, 377193, 377194, 377196, 377203,
          377205,
        ];

        // Her takım için maçları çek — getgamesbyteam veya benzer endpoint
        const pendingGames = [];
        const teamSeen = new Set();

        // Batch olarak çek (5'erli gruplar)
        for (let i = 0; i < ALL_SFK_TEAM_IDS.length; i += 5) {
          const batch = ALL_SFK_TEAM_IDS.slice(i, i + 5);
          const results = await Promise.allSettled(batch.map(teamId =>
            minfotbollGet(
              `/api/calendarapi/getteamcalendarevents?teamId=${teamId}&fromDate=${from}&toDate=${to}`,
              mfToken
            ).catch(() => [])
          ));
          results.forEach(r => {
            if (r.status !== 'fulfilled') return;
            const val = r.value;
            const events = Array.isArray(val) ? val : (val?.Events || val?.events || []);
            events.forEach(g => {
              const gameId = g.GameID || g.gameId || g.EventID;
              if (!gameId || teamSeen.has(gameId)) return;
              const gameDate = new Date(g.GameTime || g.StartDate || g.Date || g.StartTime);
              if (gameDate < fromDate || gameDate > toDate) return;
              teamSeen.add(gameId);
              pendingGames.push(g);
            });
          });
        }

        // Arena bilgisi için her maçı kontrol et (paralel, 6'lı batch)
        for (let i = 0; i < pendingGames.length; i += 6) {
          const batch = pendingGames.slice(i, i + 6);
          const checked = await Promise.allSettled(batch.map(async g => {
            const gameId = g.GameID || g.gameId || g.EventID;
            if (!gameId || seen.has(gameId)) return null;
            try {
              const overview = await minfotbollGet(
                `/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken
              );
              const arenaId = overview?.Arena?.ArenaID;
              if (!arenaId || !SFK_ARENAS[arenaId]) return null;
              if (!Object.keys(arenasToQuery).includes(arenaId.toString())) return null;
              seen.add(gameId);
              const league = overview?.Competition?.CompetitionName || g.LeagueName || '—';
              return {
                gameId,
                gameDate: g.GameTime || g.StartDate || g.Date,
                homeTeam: overview?.HomeTeam?.TeamName || g.HomeTeamName || '—',
                awayTeam: overview?.AwayTeam?.TeamName || g.AwayTeamName || '—',
                homeScore: overview?.HomeTeamGoals ?? null,
                awayScore: overview?.AwayTeamGoals ?? null,
                arenaId, arenaName: SFK_ARENAS[arenaId],
                leagueName: league, gameType: getGameType(league),
              };
            } catch(e) { return null; }
          }));
          checked.forEach(r => { if (r.status === 'fulfilled' && r.value) allGames.push(r.value); });
        }
      }

      allGames.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
      return res.status(200).json({ count: allGames.length, games: allGames });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

    // FOGIS public API - arena bazlı maç çekme
    function fogisGet(path) {
      return new Promise((resolve, reject) => {
        const req = require('https').request({
          host: 'fogis-api-client-service.reky.se',
          path: path,
          method: 'GET',
          headers: { 'Accept': 'application/json', 'User-Agent': 'SFK-App/1.0' }
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try { resolve(JSON.parse(data)); } catch(e) { resolve([]); }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
    }

    try {
      const from = dateFrom || new Date().toISOString().slice(0,10);
      const to   = dateTo   || new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10);
      const fromDate = new Date(from);
      const toDate   = new Date(to + 'T23:59:59');

      const allGames = [];
      const seen = new Set();

      // Önce FOGIS public API ile tüm arenaları paralel sorgula
      const arenaEntries = Object.entries(arenasToQuery);

      // FOGIS'ten her arena için maçları çek
      const fogisResults = await Promise.allSettled(arenaEntries.map(async ([arenaIdStr, arenaName]) => {
        const arenaIdNum = parseInt(arenaIdStr);
        // FOGIS facility endpoint
        const fogisGames = await fogisGet(`/matches?facilityIds=${arenaIdNum}&minDate=${from}&maxDate=${to}`);
        return { arenaIdNum, arenaName, fogisGames };
      }));

      let fogisWorked = false;
      fogisResults.forEach(result => {
        if (result.status !== 'fulfilled') return;
        const { arenaIdNum, arenaName, fogisGames } = result.value;
        if (!Array.isArray(fogisGames) || fogisGames.length === 0) return;
        fogisWorked = true;
        fogisGames.forEach(g => {
          const gameId = g.matchId || g.id || g.GameId;
          if (!gameId || seen.has(gameId)) return;
          seen.add(gameId);
          const homeTeam = g.homeTeamName || (g.homeTeam && (g.homeTeam.teamName || g.homeTeam.name)) || '—';
          const awayTeam = g.awayTeamName || (g.awayTeam && (g.awayTeam.teamName || g.awayTeam.name)) || '—';
          const league   = g.competitionName || g.leagueName || g.seriesName || '—';
          allGames.push({
            gameId, gameDate: g.startTime || g.matchDate || g.date,
            homeTeam, awayTeam,
            homeScore: g.homeGoals ?? null, awayScore: g.awayGoals ?? null,
            arenaId: arenaIdNum, arenaName,
            leagueName: league, gameType: getGameType(league),
          });
        });
      });

      // FOGIS çalışmadıysa MinFotboll ile club bazlı çek + arena filtresi uygula
      if (!fogisWorked) {
        // FOGIS club endpoint dene
        try {
          const clubGames = await fogisGet(`/matches?clubIds=7184&minDate=${from}&maxDate=${to}`);
          if (Array.isArray(clubGames) && clubGames.length > 0) {
            clubGames.forEach(g => {
              const gameId = g.matchId || g.id;
              if (!gameId || seen.has(gameId)) return;
              const facilityId = g.facilityId || (g.facility && g.facility.id);
              if (!facilityId || !SFK_ARENAS[facilityId]) return;
              if (!Object.keys(arenasToQuery).includes(facilityId.toString())) return;
              seen.add(gameId);
              const homeTeam = g.homeTeamName || (g.homeTeam && g.homeTeam.teamName) || '—';
              const awayTeam = g.awayTeamName || (g.awayTeam && g.awayTeam.teamName) || '—';
              const league   = g.competitionName || g.leagueName || '—';
              allGames.push({
                gameId, gameDate: g.startTime || g.matchDate,
                homeTeam, awayTeam,
                homeScore: g.homeGoals ?? null, awayScore: g.awayGoals ?? null,
                arenaId: facilityId, arenaName: SFK_ARENAS[facilityId],
                leagueName: league, gameType: getGameType(league),
              });
            });
          }
        } catch(e) {}

        // Hâlâ boşsa MinFotboll'dan maç çek + her maç için arena kontrol et
        if (allGames.length === 0) {
          const mfToken = await getMinfotbollToken();

          // MinFotboll searchgames - arena/tesis bazlı
          for (const [arenaIdStr, arenaName] of arenaEntries) {
            const arenaIdNum = parseInt(arenaIdStr);
            try {
              const mfGames = await minfotbollGet(
                `/api/gameresultapi/searchgames?facilityId=${arenaIdNum}&fromDate=${from}&toDate=${to}`,
                mfToken
              );
              if (Array.isArray(mfGames)) {
                mfGames.forEach(g => {
                  const gameId = g.GameID || g.gameId;
                  if (!gameId || seen.has(gameId)) return;
                  seen.add(gameId);
                  const league = g.LeagueName || g.CompetitionName || '—';
                  allGames.push({
                    gameId, gameDate: g.GameTime || g.GameDate || g.StartTime,
                    homeTeam: g.HomeTeamDisplayName || g.HomeTeamName || '—',
                    awayTeam: g.AwayTeamDisplayName || g.AwayTeamName || '—',
                    homeScore: g.HomeTeamScore ?? null, awayScore: g.AwayTeamScore ?? null,
                    arenaId: arenaIdNum, arenaName,
                    leagueName: league, gameType: getGameType(league),
                  });
                });
              }
            } catch(e) {}
          }

          // Son çare: tüm SFK takımlarının maçlarını çek, arena filtresi uygula
          if (allGames.length === 0) {
            // Tüm distinct takım ID'lerini kullan (takim.txt'den gelen aktif takımlar)
            const ALL_SFK_TEAMS = [
              // Senior + Ungdom ana takımlar
              245984, 151108, 303423, 233248, 318812, 212391, 303424, 371423, 372401,
              345610, 345609, 345586, 345596, 345598, 345600, 345602, 345603, 345604,
              345605, 345606, 345552, 345553, 345555, 345556, 345557, 345559, 345560,
              345561, 345562, 345563, 345565, 345566, 345567, 345568, 345569, 345570,
              345571, 345575, 345578, 345580, 345627, 345628, 345629, 345639, 345640,
              345641, 348052, 348053, 348055, 348056, 348057, 348059, 348061, 348062,
              348063, 342453, 318035, 291602, 263767, 293038, 318840, 287010,
              // 2026 sezon takımları
              367665, 367666, 367669, 367670, 367672, 367673, 367676, 367677, 367678,
              367679, 367680, 367685, 367687, 367694, 367695, 367697, 367700, 367703,
              367704, 367708, 367709, 367713, 367717, 367720, 367722, 367726, 367727,
              367728, 367730, 367731, 367733, 366637, 366640, 366643, 366644, 366645,
              366646, 366647, 366648, 371427, 371428, 371432, 371433, 371423, 372401,
              374769, 374800,
            ];

            // Bu takımlar için maçları paralel çek (gruplar halinde)
            const teamBatchSize = 5;
            const pendingGames = [];
            const teamsSeen = new Set();

            for (let i = 0; i < ALL_SFK_TEAMS.length; i += teamBatchSize) {
              const batch = ALL_SFK_TEAMS.slice(i, i + teamBatchSize);
              const results = await Promise.allSettled(batch.map(teamId =>
                minfotbollGet(`/api/leagueapi/getgamesbyteam?teamId=${teamId}&fromDate=${from}&toDate=${to}`, mfToken)
                  .catch(() => [])
              ));
              results.forEach(r => {
                if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
                r.value.forEach(g => {
                  const gameId = g.GameID || g.gameId;
                  if (!gameId || teamsSeen.has(gameId)) return;
                  teamsSeen.add(gameId);
                  const gameDate = new Date(g.GameTime || g.GameDate || g.StartTime);
                  if (gameDate < fromDate || gameDate > toDate) return;
                  pendingGames.push(g);
                });
              });
            }

            // Her maç için arena bilgisini kontrol et (paralel, max 6)
            const checkBatch = 6;
            for (let i = 0; i < pendingGames.length; i += checkBatch) {
              const batch = pendingGames.slice(i, i + checkBatch);
              const checked = await Promise.allSettled(batch.map(async g => {
                const gameId = g.GameID || g.gameId;
                if (seen.has(gameId)) return null;
                const overview = await minfotbollGet(
                  `/api/magazinegameviewapi/initgameoverview?GameID=${gameId}`, mfToken
                );
                const arenaId = overview?.Arena?.ArenaID;
                if (!arenaId || !SFK_ARENAS[arenaId]) return null;
                if (!Object.keys(arenasToQuery).includes(arenaId.toString())) return null;
                seen.add(gameId);
                const league = g.LeagueName || g.CompetitionName || overview?.Competition?.Name || '—';
                return {
                  gameId, gameDate: g.GameTime || g.GameDate || g.StartTime,
                  homeTeam: g.HomeTeamDisplayName || g.HomeTeamName || '—',
                  awayTeam: g.AwayTeamDisplayName || g.AwayTeamName || '—',
                  homeScore: g.HomeTeamScore ?? null, awayScore: g.AwayTeamScore ?? null,
                  arenaId, arenaName: SFK_ARENAS[arenaId],
                  leagueName: league, gameType: getGameType(league),
                };
              }));
              checked.forEach(r => { if (r.status === 'fulfilled' && r.value) allGames.push(r.value); });
            }
          }
        }
      }

      // Tarihe göre sırala
      allGames.sort((a,b) => new Date(a.gameDate) - new Date(b.gameDate));

      return res.status(200).json({ count: allGames.length, games: allGames });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DEBUG: MinFotboll endpoint testi
  if (action === 'debugarena') {
    const testArenaId = req.query.arenaId || '21808';
    const from = req.query.from || new Date().toISOString().slice(0,10);
    const to = req.query.to || new Date(Date.now() + 60*24*60*60*1000).toISOString().slice(0,10);
    const mfToken = await getMinfotbollToken();
    const FOGIS_API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';

    const results = {};

    // MinFotboll endpoint'lerini test et
    const mfEndpoints = [
      `/api/gameresultapi/searchgames?facilityId=${testArenaId}&fromDate=${from}&toDate=${to}`,
      `/api/gameresultapi/searchgames?arenaId=${testArenaId}&fromDate=${from}&toDate=${to}`,
      `/api/calendarapi/getfacilitycalendarevents?facilityId=${testArenaId}&fromDate=${from}&toDate=${to}`,
      `/api/arenaapi/getgamesbyarena?arenaId=${testArenaId}&fromDate=${from}&toDate=${to}`,
      `/api/gameapi/getgamesbyarena?arenaId=${testArenaId}&fromDate=${from}&toDate=${to}`,
      `/api/gameapi/getgamesbyarena?ArenaID=${testArenaId}&DateFrom=${from}&DateTo=${to}`,
      `/api/magazinegameviewapi/searchgames?arenaId=${testArenaId}&fromDate=${from}&toDate=${to}`,
    ];

    await Promise.all(mfEndpoints.map(async ep => {
      try {
        const r = await minfotbollGet(ep, mfToken);
        const isArray = Array.isArray(r);
        const len = isArray ? r.length : (r && typeof r === 'object' ? Object.keys(r).length : -1);
        results[ep] = { status: 'ok', isArray, len, sample: isArray && r[0] ? Object.keys(r[0]).slice(0,5) : (r && typeof r === 'object' ? Object.keys(r).slice(0,5) : r) };
      } catch(e) { results[ep] = { status: 'error', msg: e.message }; }
    }));

    // FOGIS API test
    const fogisEndpoints = [
      `/matches?facilityIds=${testArenaId}&minDate=${from}&maxDate=${to}`,
      `/club/matches?facilityId=${testArenaId}&from=${from}&to=${to}`,
    ];

    await Promise.all(fogisEndpoints.map(async ep => {
      try {
        const r = await new Promise((resolve, reject) => {
          const isClub = ep.startsWith('/club');
          const req2 = require('https').request({
            host: 'forening-api.svenskfotboll.se',
            path: isClub ? ep : `/club${ep}`,
            method: 'GET',
            headers: { 'ApiKey': FOGIS_API_KEY, 'Accept': 'application/json' }
          }, (response) => {
            let data=''; response.on('data',c=>data+=c);
            response.on('end',()=>{try{resolve(JSON.parse(data))}catch(e){resolve(data)}});
          });
          req2.on('error', reject); req2.end();
        });
        const isArray = Array.isArray(r);
        results['FOGIS:'+ep] = { status: 'ok', isArray, len: isArray ? r.length : -1, sample: isArray && r[0] ? Object.keys(r[0]).slice(0,5) : r };
      } catch(e) { results['FOGIS:'+ep] = { status: 'error', msg: e.message }; }
    }));

    return res.status(200).json(results);
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

  res.status(400).json({ error: 'Ogiltig åtgärd' });
};

// deploy trigger Wed Mar 25 13:32:45 UTC 2026
