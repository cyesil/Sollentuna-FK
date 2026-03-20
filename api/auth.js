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
    if (!username || !password) return res.status(400).json({ error: 'Eksik bilgi' });

    const hash = hashPassword(password);
    const users = await supabaseRequest('GET', `/users?username=eq.${encodeURIComponent(username)}&select=*`);
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    
    const user = users[0];
    if (user.password_hash !== hash) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }

    const token = createToken(user);
    return res.status(200).json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, player_id: user.player_id } });
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
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Yetki yok' });

    const { username, password, role, full_name, player_id } = req.body || {};
    if (!username || !password || !role) return res.status(400).json({ error: 'Eksik bilgi' });

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
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Yetki yok' });

    const users = await supabaseRequest('GET', '/users?select=id,username,role,full_name,player_id,created_at');
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

  // Kullanıcı düzenle (sadece admin)
  if (action === 'edituser' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Yetki yok' });
    const { id, username, full_name, role, player_id } = req.body || {};
    if (!id || !username) return res.status(400).json({ error: 'Eksik bilgi' });
    const result = await supabaseRequest('PATCH', `/users?id=eq.${id}`, {
      username, full_name, role, player_id: player_id || null
    });
    return res.status(200).json({ success: true });
  }

  // Şifre değiştir (sadece admin)
  if (action === 'changepassword' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Yetki yok' });
    const { id, password } = req.body || {};
    if (!id || !password) return res.status(400).json({ error: 'Eksik bilgi' });
    const hash = hashPassword(password);
    await supabaseRequest('PATCH', `/users?id=eq.${id}`, { password_hash: hash });
    return res.status(200).json({ success: true });
  }

  // Kullanıcı sil (sadece admin)
  if (action === 'deleteuser' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Yetki yok' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID gerekli' });
    await supabaseRequest('DELETE', `/users?id=eq.${id}`, null);
    return res.status(200).json({ success: true });
  }

  res.status(400).json({ error: 'Geçersiz istek' });
};
