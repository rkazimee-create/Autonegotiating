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

// Tokens that are drive-train/AWD suffixes, not standalone trim names
const SUFFIX_ONLY = new Set(['xdrive', 'awd', 'fwd', 'rwd', '4wd', '4x4', '4motion', 'quattro']);

function isValidTrim(trim) {
  if (!trim) return false;
  const t = trim.toLowerCase().trim();
  // Filter out pure AWD/drivetrain suffixes
  if (SUFFIX_ONLY.has(t)) return false;
  // Must be at least 2 chars
  if (t.length < 2) return false;
  return true;
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

  const authHeaders = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
  };

  const trimSet = new Set();
  let totalFetched = 0;

  // Fetch up to 3 pages to get broader trim coverage
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams();
    params.set('make',     make);
    params.set('model',    model);
    params.set('zip',      '44114');
    params.set('distance', '5000');
    params.set('limit',    '100');
    params.set('page',     String(page));

    const url = 'https://auto.dev/api/listings?' + params.toString();
    console.log('Trims URL page ' + page + ':', url);

    try {
      const res = await httpsGet(url, authHeaders);
      const data = JSON.parse(res.body);
      if (!res.ok) break;

      const records = data.records || [];
      if (records.length === 0) break;
      totalFetched += records.length;

      records.forEach(function(r) {
        const trim = r.trim ? r.trim.trim() : '';
        if (isValidTrim(trim)) trimSet.add(trim);
      });

      // Stop early if we've seen all listings
      const total = data.totalCount || 0;
      if (totalFetched >= total) break;
    } catch (err) {
      console.error('Trims page ' + page + ' error:', err.message);
      break;
    }
  }

  const trims = Array.from(trimSet).sort();
  console.log('Unique trims found:', trims.length, 'from', totalFetched, 'records');

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ trims, total: totalFetched }),
  };
};
