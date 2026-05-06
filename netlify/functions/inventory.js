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
    req.setTimeout(9000, function() { req.destroy(new Error('Request timed out. Try a smaller radius.')); });
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
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'AUTODEV_API_KEY not configured.' }),
    };
  }

  const q = event.queryStringParameters || {};
  const params = new URLSearchParams();

  const make  = q.make  || q['vehicle.make'];
  const model = q.model || q['vehicle.model'];

  if (q.vin)       params.set('vin', q.vin);
  if (make)        params.set('vehicle.make',  make);
  if (model)       params.set('vehicle.model', model);
  if (q.bodyStyle) params.set('vehicle.bodyStyle', q.bodyStyle);

  // Condition filtering
  const condition = q.condition || '';
  if (condition === 'used') {
    params.set('retailListing.used', 'true');
  } else if (condition === 'cpo') {
    params.set('retailListing.cpo', 'true');
  } else if (condition === 'new') {
    params.set('retailListing.used', 'false');
    params.set('retailListing.cpo', 'false');
  }

  // Location
  if (q.zip) params.set('retailListing.zip', q.zip);

  // Pagination (V2 uses page= only, 100 per page)
  if (q.page) params.set('page', q.page);

  const url = 'https://api.auto.dev/listings?' + params.toString();
  console.log('Inventory URL:', url);

  try {
    const response = await httpsGet(url, {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(response.body);

    if (!response.ok) {
      const msg = (data.error && data.error.error) || data.message || 'Auto.dev error ' + response.status;
      return { statusCode: response.status, headers, body: JSON.stringify({ error: msg }) };
    }

    const raw        = data.data || [];
    const totalCount = data.meta ? data.meta.total : raw.length;

    const records = raw.map(function(r) {
      const v  = r.vehicle       || {};
      const rl = r.retailListing || {};

      const condition = rl.cpo  ? 'cpo'
        : rl.used === false     ? 'new'
        : 'used';

      // Generate photo URLs from photoCount
      const vin = r.vin || '';
      const photoCount = rl.photoCount || 0;
      const photoUrls = [];
      if (rl.primaryImage) photoUrls.push(rl.primaryImage);
      for (let i = 2; i <= Math.min(photoCount, 20); i++) {
        photoUrls.push('https://retail.photos.vin/' + vin + '-' + i + '.jpg');
      }

      return {
        id:                 vin || r['@id'],
        vin:                vin || null,
        make:               v.make              || '',
        model:              v.model             || '',
        trim:               v.trim              || '',
        year:               v.year              || 0,
        displayColor:       v.exteriorColor     || '',
        color:              v.exteriorColor     || '',
        bodyStyle:          v.bodyStyle         || '',
        bodyType:           v.bodyStyle         || '',
        engine:             v.engine            || '',
        transmission:       v.transmission      || '',
        drivetrain:         v.drivetrain        || '',
        fuelType:           v.fuel              || '',
        priceUnformatted:   rl.price            || 0,
        price:              rl.price            || 0,
        mileageUnformatted: rl.miles            || 0,
        condition,
        dealerName:         rl.dealer           || '',
        city:               rl.city             || '',
        state:              rl.state            || '',
        primaryPhotoUrl:    rl.primaryImage     || null,
        photoUrls,
        carfaxUrl:          rl.carfaxUrl        || null,
        distanceFromOrigin: null,
        history:            r.history           || null,
      };
    });

    // Client-side year filtering (V2 lacks year-range params)
    const minYear = parseInt(q.minYear) || 0;
    const maxYear = parseInt(q.maxYear) || 0;
    const filtered = records.filter(function(r) {
      if (minYear && r.year < minYear) return false;
      if (maxYear && r.year > maxYear) return false;
      return true;
    });

    console.log('totalCount:', totalCount, '| returned:', records.length, '| after year filter:', filtered.length);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: filtered, totalCount }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Proxy fetch failed' }),
    };
  }
};
