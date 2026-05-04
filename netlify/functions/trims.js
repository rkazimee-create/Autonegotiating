const https = require('https');

function httpsGet(url, headers) {
  return new Promise(function(resolve, reject) {
    const req = https.get(url, { headers, maxHeaderSize: 65536 }, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: data });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(9000, function() { req.destroy(new Error('timeout')); });
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
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AUTODEV_API_KEY not configured.' }) };
  }

  const q = event.queryStringParameters || {};
  const make  = q.make  || '';
  const model = q.model || '';

  if (!make || !model) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'make and model are required' }) };
  }

  const params = new URLSearchParams();
  params.set('make',  make);
  params.set('model', model);
  params.set('zip',      '44114');
  params.set('distance', '5000');
  params.set('limit',    '100');

  const url = 'https://auto.dev/api/listings?' + params.toString();
  console.log('Trims URL:', url);

  try {
    const res = await httpsGet(url, {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(res.body);
    if (!res.ok) throw new Error(data.message || 'Auto.dev error ' + res.status);

    const records = data.records || [];
    console.log('Trims records:', records.length);

    const trimSet = new Set();
    records.forEach(function(r) {
      const trim = r.trim ? r.trim.trim() : '';
      if (trim) trimSet.add(trim);
    });

    const trims = Array.from(trimSet).sort();
    console.log('Unique trims found:', trims.length);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ trims, total: records.length }),
    };
  } catch (err) {
    console.error('Trims error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
