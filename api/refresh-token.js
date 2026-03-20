const https = require('https');

const MINFOTBOLL_API = 'minfotboll-api.azurewebsites.net';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

function httpPost(host, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      host, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpPatch(host, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      host, path, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Güvenlik — sadece secret key ile çalışsın
  const secret = req.query.secret;
  if (secret !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'Yetkisiz erişim' });
  }

  try {
    const refreshToken = process.env.MINFOTBOLL_REFRESH_TOKEN;
    const accessToken = process.env.MINFOTBOLL_ACCESS_TOKEN;

    // Yeni token al
    const result = await httpPost(MINFOTBOLL_API, '/api/jwtapi/refreshtoken', {
      accessToken, refreshToken
    });

    if (!result.AccessToken) {
      return res.status(500).json({ error: 'Token yenileme başarısız', detail: result });
    }

    // Vercel env variable'larını güncelle
    if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
      const path = `/v9/projects/${VERCEL_PROJECT_ID}/env${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ''}`;
      
      // Mevcut env variable'ları listele
      const listResult = await new Promise((resolve, reject) => {
        const req = https.request({
          host: 'api.vercel.com',
          path,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
        }, (r) => {
          let d = '';
          r.on('data', chunk => d += chunk);
          r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
        });
        req.on('error', reject);
        req.end();
      });

      const envs = listResult.envs || [];
      const accessEnv = envs.find(e => e.key === 'MINFOTBOLL_ACCESS_TOKEN');
      const refreshEnv = envs.find(e => e.key === 'MINFOTBOLL_REFRESH_TOKEN');

      // Access token güncelle
      if (accessEnv) {
        await new Promise((resolve, reject) => {
          const body = JSON.stringify({ value: result.AccessToken });
          const r = https.request({
            host: 'api.vercel.com',
            path: `/v9/projects/${VERCEL_PROJECT_ID}/env/${accessEnv.id}${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ''}`,
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
          r.on('error', reject);
          r.write(body);
          r.end();
        });
      }

      // Refresh token güncelle (değişmişse)
      if (refreshEnv && result.RefreshToken !== refreshToken) {
        await new Promise((resolve, reject) => {
          const body = JSON.stringify({ value: result.RefreshToken });
          const r = https.request({
            host: 'api.vercel.com',
            path: `/v9/projects/${VERCEL_PROJECT_ID}/env/${refreshEnv.id}${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ''}`,
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
          r.on('error', reject);
          r.write(body);
          r.end();
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Token yenilendi ve Vercel güncellendi',
        expires: result.Expires,
        vercelUpdated: true
      });
    }

    // Vercel API token yoksa sadece yeni token'ı döndür
    return res.status(200).json({
      success: true,
      message: 'Token yenilendi (Vercel güncellenmedi)',
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expires: result.Expires,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
