const https = require('https');

module.exports = (req, res) => {
  const path = req.query.path || '/details';
  const url = `https://forening-api.svenskfotboll.se/club${path}`;
  const API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';

  const options = {
    headers: {
      'ApiKey': API_KEY,
      'Accept': 'application/json',
    }
  };

  https.get(url, options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(apiRes.statusCode).send(data);
    });
  }).on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
};
