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
  const targetMileage = parseInt(q.mileage) || 0;
  const targetPrice   = parseInt(q.price)   || 0;
  const targetTrim    = (q.trim || '').toLowerCase().trim();
  const targetYear    = parseInt(q.year)    || 0;
  const targetCond    = q.condition || '';

  const params = new URLSearchParams();
  if (q.make)  params.set('make',  q.make);
  if (q.model) params.set('model', q.model);
  params.set('zip',      '44114');
  params.set('distance', '5000');
  params.set('limit',    '100');

  const url = 'https://auto.dev/api/listings?' + params.toString();
  console.log('Comparables URL:', url);

  try {
    const response = await httpsGet(url, {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(response.body);
    if (!response.ok) throw new Error(data.message || 'Auto.dev error ' + response.status);

    const raw = data.records || [];
    console.log('Raw records from v1:', raw.length);

    let records = raw.map(function(r) {
      return {
        year:               r.year              || 0,
        make:               r.make              || '',
        model:              r.model             || '',
        trim:               r.trim              || '',
        vin:                r.vin               || '',
        priceUnformatted:   r.priceUnformatted  || 0,
        mileageUnformatted: r.mileageUnformatted || 0,
        displayColor:       r.displayColor      || '',
        condition:          r.condition         || 'used',
        dealerName:         r.dealerName        || '',
        city:               r.city              || '',
        state:              r.state             || '',
      };
    });

    // Client-side filters
    if (targetYear) {
      records = records.filter(function(r) {
        return r.year >= targetYear - 1 && r.year <= targetYear + 1;
      });
      console.log('After year filter (±1):', records.length);
    }

    if (targetCond) {
      const condMap = { cpo: 'certified', new: 'new', used: 'used' };
      const mapped = condMap[targetCond];
      if (mapped) {
        records = records.filter(function(r) { return r.condition === mapped; });
        console.log('After condition filter:', records.length);
      }
    }

    // Trim scoring
    function trimScore(recordTrim) {
      if (!targetTrim || !recordTrim) return 0;
      const rt = recordTrim.toLowerCase().trim();
      if (rt === targetTrim) return 100;
      if (rt.includes(targetTrim) || targetTrim.includes(rt)) return 60;
      const targetFirst = targetTrim.split(/[\s-]/)[0];
      const rtFirst = rt.split(/[\s-]/)[0];
      if (targetFirst.length > 1 && rtFirst === targetFirst) return 30;
      return 0;
    }

    let comparables = records
      .filter(function(r) { return r.priceUnformatted > 0; })
      .map(function(r) {
        const price = r.priceUnformatted || 0;
        const miles = r.mileageUnformatted || 0;
        const trim  = r.trim || '';
        return {
          year:            r.year,
          make:            r.make,
          model:           r.model,
          trim,
          vin:             r.vin || '',
          price,
          mileage:         miles,
          mileageFormatted: miles > 0 ? Math.round(miles).toLocaleString() + ' mi' : '',
          color:           r.displayColor || '',
          condition:       r.condition || 'used',
          dealer:          r.dealerName || '',
          city:            r.city || '',
          state:           r.state || '',
          priceFormatted:  '$' + Math.round(price).toLocaleString(),
          trimScore:       trimScore(trim),
        };
      });

    console.log('After price filter:', comparables.length);

    // Trim filter — always enforce when trim is specified
    if (targetTrim) {
      const exactMatches   = comparables.filter(function(c) { return c.trimScore >= 60; });
      const partialMatches = comparables.filter(function(c) { return c.trimScore >= 30; });
      if (exactMatches.length > 0) {
        comparables = exactMatches;
      } else if (partialMatches.length > 0) {
        comparables = partialMatches;
      }
      // If still 0 — keep all (trim data may be absent from API)
      console.log('Trim matches (exact/partial):', exactMatches.length, '/', partialMatches.length);
    }

    // Sort: trim score, then mileage proximity, then price
    comparables.sort(function(a, b) {
      if (b.trimScore !== a.trimScore) return b.trimScore - a.trimScore;
      if (targetMileage > 0) return Math.abs(a.mileage - targetMileage) - Math.abs(b.mileage - targetMileage);
      return a.price - b.price;
    });

    comparables = comparables.slice(0, 20);

    const prices     = comparables.map(function(c) { return c.price;   }).filter(Boolean);
    const milesArr   = comparables.map(function(c) { return c.mileage; }).filter(Boolean);
    const avgPrice   = prices.length   ? Math.round(prices.reduce(function(s,p){return s+p;},0)/prices.length) : 0;
    const minPrice   = prices.length   ? Math.min.apply(null, prices)   : 0;
    const maxPrice   = prices.length   ? Math.max.apply(null, prices)   : 0;
    const avgMileage = milesArr.length ? Math.round(milesArr.reduce(function(s,m){return s+m;},0)/milesArr.length) : 0;
    const pricePosition = prices.length > 0 && targetPrice > 0
      ? Math.round((prices.filter(function(p){return p<=targetPrice;}).length / prices.length) * 100)
      : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        comparables,
        stats: { count: comparables.length, totalFound: data.totalCount || raw.length, avgPrice, minPrice, maxPrice, avgMileage, pricePosition },
      }),
    };
  } catch (err) {
    console.error('Comparables error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
