const https = require('https');

module.exports = (req, res) => {
  const path = req.query.path || '/details';
  const url = `https://forening-api.svenskfotboll.se/club${path}`;
  const API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const request = https.get(url, {
    headers: {
      'ApiKey': API_KEY,
      'Accept': 'application/json',
    }
  }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      res.status(response.statusCode).send(data);
    });
  });

  request.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
};
