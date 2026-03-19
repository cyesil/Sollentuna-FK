const https = require('https');

exports.handler = async (event) => {
  const path = event.queryStringParameters?.path || '/details';
  const url = `https://forening-api.svenskfotboll.se/club${path}`;
  const API_KEY = '22a66c836d2f49a3bb4820131eb5d1a4';

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'ApiKey': API_KEY,
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: data,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: err.message }),
      });
    });
  });
};
