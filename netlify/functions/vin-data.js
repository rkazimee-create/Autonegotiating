const https = require('https');

function httpsGet(url, headers) {
  return new Promise(function(resolve, reject) {
    const req = https.get(url, { headers, maxHeaderSize: 65536 }, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(new Error('timeout')); });
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const apiKey = process.env.AUTODEV_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'AUTODEV_API_KEY not configured.' }) };

  const vin = (event.queryStringParameters || {}).vin || '';
  if (!vin) return { statusCode: 400, headers, body: JSON.stringify({ error: 'vin is required' }) };

  const authHeaders = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  const base = 'https://api.auto.dev/';

  const [specsRes, aprRes, tcoRes, recallsRes, buildRes] = await Promise.allSettled([
    httpsGet(base + 'specs/'    + vin, authHeaders),
    httpsGet(base + 'apr/'     + vin, authHeaders),
    httpsGet(base + 'tco/'     + vin, authHeaders),
    httpsGet(base + 'recalls/' + vin, authHeaders),
    httpsGet(base + 'build/'   + vin, authHeaders),
  ]);

  function parse(settled) {
    if (settled.status !== 'fulfilled' || !settled.value.ok) return null;
    try { return JSON.parse(settled.value.body); } catch { return null; }
  }

  const specs   = parse(specsRes);
  const apr     = parse(aprRes);
  const tco     = parse(tcoRes);
  const recalls = parse(recallsRes);
  const build   = parse(buildRes);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      specs:   specs   ? specs.specs          : null,
      vehicle: specs   ? specs.vehicle        : (apr ? apr.vehicle : null),
      apr:     apr     ? apr.apr              : null,
      tco:     tco     ? tco.tco             : null,
      recalls: recalls ? recalls.data         : null,
      totalRecalls: recalls ? recalls.totalRecalls : 0,
      build:   build && !build.error ? build.build : null,
    }),
  };
};
