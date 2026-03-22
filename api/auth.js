const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'sfk2026gizliAnahtar!';

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = (body && method !== 'GET' && method !== 'DELETE') ? JSON.stringify(body) : '';
    const url = new URL(SUPABASE_URL);
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
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function httpGet(host, path, headers={}) {
  return new Promise((resolve, reject) => {
    const req = require('https').request({host, path, method:'GET', headers}, (res) => {
      let data='';
      res.on('data', chunk => data+=chunk);
      res.on('end', () => { try{resolve(JSON.parse(data))}catch(e){resolve(data)} });
    });
    req.on('error', reject);
    req.end();
  });
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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

function createToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    player_id: user.player_id,
    full_name: user.full_name,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 saat
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Body parse
  if (req.method === 'POST' && !req.body) {
    await new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try { req.body = JSON.parse(body); } catch(e) { req.body = {}; }
        resolve();
      });
    });
  }

  const action = req.query.action;

  // Body test
  if (action === 'testbody') {
    return res.status(200).json({ 
      body: req.body, 
      bodyType: typeof req.body,
      username: req.body?.username,
      password: req.body?.password,
    });
  }

  // Login debug
  if (action === 'logindebug' && req.method === 'POST') {
    const { username, password } = req.body || {};
    const hash = hashPassword(password);
    const users = await supabaseRequest('GET', `/users?username=eq.${encodeURIComponent(username)}&select=*`);
    const dbHash = Array.isArray(users) && users[0] ? users[0].password_hash : 'NOT FOUND';
    return res.status(200).json({ 
      computedHash: hash, 
      dbHash, 
      match: hash === dbHash,
      usersFound: Array.isArray(users) ? users.length : 0
    });
  }

  // Login
  if (action === 'login' && req.method === 'POST') {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Information saknas' });

    const hash = hashPassword(password);
    const users = await supabaseRequest('GET', `/users?username=eq.${encodeURIComponent(username)}&select=*`);
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ error: 'Felaktigt användarnamn eller lösenord' });
    }
    
    const user = users[0];
    if (user.password_hash !== hash) {
      return res.status(401).json({ error: 'Felaktigt användarnamn eller lösenord' });
    }

    const token = createToken(user);
        // MemberID varsa MinFotboll'dan avatar çek
    let avatarUrl = user.avatar_url || null;
    if (!avatarUrl && user.minfotboll_member_id) {
      try {
        const mfToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
        // TeamStaff'tan çek - her iki takım için dene
        for (const teamId of [398871, 74782]) {
          const roster = await httpGet('minfotboll-api.azurewebsites.net', `/api/teamapi/initplayersadminvc?TeamID=${teamId}`, {'Authorization': `Bearer ${mfToken}`});
          if (Array.isArray(roster)) {
            // Staff endpoint yok, players'da ara
          }
          // Farklı endpoint dene
          break;
        }
      } catch(e) {}
    }
    return res.status(200).json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, player_id: user.player_id, avatar_url: avatarUrl, minfotboll_member_id: user.minfotboll_member_id || null } });
  }

  // Token doğrula
  if (action === 'verify') {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Geçersiz token' });
    return res.status(200).json({ user: payload });
  }

  // Kullanıcı ekle (sadece admin)
  if (action === 'adduser' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || payload.role === 'oyuncu') return res.status(403).json({ error: 'Behörighet saknas' });

    const { username, password, role, full_name, player_id } = req.body || {};
    if (!username || !password || !role) return res.status(400).json({ error: 'Information saknas' });

    // Tränare sadece oyuncu yaratabilir
    if (payload.role === 'antrenor' && role !== 'oyuncu') {
      return res.status(403).json({ error: 'Tränare kan bara skapa spelare' });
    }

    const hash = hashPassword(password);
    const result = await supabaseRequest('POST', '/users', {
      username, password_hash: hash, role, full_name, player_id: player_id || null
    });

    return res.status(200).json({ success: true, user: result });
  }

  // Kullanıcıları listele (sadece admin)
  if (action === 'users') {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'antrenor')) return res.status(403).json({ error: 'Behörighet saknas' });

    const users = await supabaseRequest('GET', '/users?select=id,username,role,full_name,player_id,avatar_url,minfotboll_member_id,created_at');
    // Tränare sadece spelare rolündeki kullanıcıları görür
    if (payload.role === 'antrenor') {
      return res.status(200).json(Array.isArray(users) ? users.filter(u => u.role === 'oyuncu') : users);
    }
    return res.status(200).json(users);
  }

  // Debug - Supabase bağlantı testi
  if (action === 'debug') {
    try {
      const url = new URL(SUPABASE_URL);
      const result = await supabaseRequest('GET', '/users?select=username,role&limit=5');
      return res.status(200).json({ ok: true, url: url.host, result });
    } catch(e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // Kullanıcı düzenle (admin + tränare)
  if (action === 'edituser' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'antrenor')) return res.status(403).json({ error: 'Behörighet saknas' });
    const { id, username, full_name, role, player_id, minfotboll_member_id } = req.body || {};
    if (!id || !username) return res.status(400).json({ error: 'Information saknas' });
    // MemberID varsa TeamStaff'tan avatar çek
    let avatar_url = null;
    if (minfotboll_member_id) {
      try {
        const mfToken = process.env.MINFOTBOLL_ACCESS_TOKEN;
        const matches = await supabaseGet('/matches?select=game_id&order=game_date.desc&limit=5');
        if (Array.isArray(matches)) {
          for (const match of matches) {
            const lineups = await httpGet('minfotboll-api.azurewebsites.net',
              `/api/magazinegameviewapi/initgamelineups?GameID=${match.game_id}`,
              {'Authorization': `Bearer ${mfToken}`}
            );
            for (const roster of [lineups?.HomeTeamGameTeamRoster, lineups?.AwayTeamGameTeamRoster]) {
              if (!roster?.TeamStaff) continue;
              const staff = roster.TeamStaff.find(s => s.MemberID === parseInt(minfotboll_member_id));
              if (staff?.ThumbnailURL && !staff.ThumbnailURL.includes('defaultmember')) {
                avatar_url = staff.ThumbnailURL;
                break;
              }
            }
            if (avatar_url) break;
          }
        }
      } catch(e) {}
    }

    await supabaseRequest('PATCH', `/users?id=eq.${id}`, {
      username, full_name, role,
      player_id: player_id || null,
      minfotboll_member_id: minfotboll_member_id || null,
      ...(avatar_url ? { avatar_url } : {}),
    });
    return res.status(200).json({ success: true, avatar_url });
  }

  // Şifre değiştir (admin her kullanıcının, tränare sadece admin olmayanların)
  if (action === 'changepassword' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'antrenor')) return res.status(403).json({ error: 'Behörighet saknas' });
    const { id, password } = req.body || {};
    if (!id || !password) return res.status(400).json({ error: 'Information saknas' });
    // Tränare admin şifresini değiştiremez
    if (payload.role === 'antrenor') {
      const target = await supabaseGet(`/users?id=eq.${id}&select=role`);
      if (Array.isArray(target) && target[0]?.role === 'admin') return res.status(403).json({ error: 'Admin şifresi değiştirilemez' });
    }
    const hash = hashPassword(password);
    await supabaseRequest('PATCH', `/users?id=eq.${id}`, { password_hash: hash });
    return res.status(200).json({ success: true });
  }

  // Kullanıcı sil (admin + tränare, admin silinemez)
  if (action === 'deleteuser' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'antrenor')) return res.status(403).json({ error: 'Behörighet saknas' });
    // Tränare admin kullanıcısını silemez
    if (payload.role === 'antrenor') {
      const { id } = req.body || {};
      const target = await supabaseGet(`/users?id=eq.${id}&select=role`);
      if (Array.isArray(target) && target[0]?.role === 'admin') return res.status(403).json({ error: 'Admin silinemez' });
    }
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID krävs' });
    await supabaseRequest('DELETE', `/users?id=eq.${id}`, null);
    return res.status(200).json({ success: true });
  }

  // Kendi şifresini değiştir (tüm roller)
  if (action === 'changeownpassword' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Vänligen logga in' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Information saknas' });
    // Mevcut şifreyi kontrol et
    const users = await supabaseGet(`/users?id=eq.${payload.id}&select=id,password_hash`);
    if (!Array.isArray(users) || users.length === 0) return res.status(404).json({ error: 'Användaren hittades inte' });
    const currentHash = hashPassword(currentPassword);
    if (users[0].password_hash !== currentHash) return res.status(400).json({ error: 'Nuvarande lösenord är felaktigt' });
    // Yeni şifreyi kaydet
    const newHash = hashPassword(newPassword);
    await supabaseRequest('PATCH', `/users?id=eq.${payload.id}`, { password_hash: newHash });
    return res.status(200).json({ success: true });
  }

  res.status(400).json({ error: 'Ogiltig förfrågan' });
};
