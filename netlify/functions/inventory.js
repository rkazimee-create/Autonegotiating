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

  if (q.zip)      params.set('zip',      q.zip);
  if (q.distance) params.set('distance', q.distance);
  if (q.page)     params.set('page',     q.page);
  if (q.limit)    params.set('limit',    q.limit);

  const make  = q.make  || q['vehicle.make'];
  const model = q.model || q['vehicle.model'];

  if (make)        params.set('make',      make);
  if (model)       params.set('model',     model);
  if (q.bodyStyle) params.set('bodyStyle', q.bodyStyle);

  if (q.minPrice && q.maxPrice) params.set('price', q.minPrice + '-' + q.maxPrice);
  else if (q.minPrice)          params.set('price', q.minPrice + '-999999999');
  else if (q.maxPrice)          params.set('price', '0-' + q.maxPrice);

  const url = 'https://auto.dev/api/listings?' + params.toString();
  console.log('Inventory URL:', url);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      const msg = (data.error && data.error.error) || data.message || 'Auto.dev error ' + response.status;
      return { statusCode: response.status, headers, body: JSON.stringify({ error: msg }) };
    }

    const raw        = data.records || [];
    const totalCount = data.totalCount || raw.length;

    const records = raw.map(function(r) {
      let condition = r.condition || 'used';

      const photoUrls = Array.isArray(r.photoUrls) && r.photoUrls.length
        ? r.photoUrls.map(function(u) { return u.split('?')[0]; })
        : (r.primaryPhotoUrl ? [r.primaryPhotoUrl] : []);

      return {
        id:                 r.vin || r.id,
        vin:                r.vin || null,
        make:               r.make              || '',
        model:              r.model             || '',
        trim:               r.trim              || '',
        year:               r.year              || 0,
        displayColor:       r.displayColor      || '',
        color:              r.displayColor      || '',
        bodyStyle:          r.bodyStyle         || r.bodyType || '',
        bodyType:           r.bodyType          || '',
        engine:             r.engine            || '',
        transmission:       r.transmission      || '',
        drivetrain:         r.drivetrain        || '',
        fuelType:           r.fuelType          || '',
        priceUnformatted:   r.priceUnformatted  || 0,
        price:              r.priceUnformatted  || 0,
        mileageUnformatted: r.mileageUnformatted || 0,
        condition,
        dealerName:         r.dealerName        || '',
        city:               r.city              || '',
        state:              r.state             || '',
        primaryPhotoUrl:    r.primaryPhotoUrl   || (photoUrls[0] || null),
        photoUrls,
        carfaxUrl:          r.carfaxUrl         || null,
        distanceFromOrigin: r.distanceFromOrigin || null,
      };
    });

    console.log('totalCount:', totalCount, '| returned:', records.length);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ data: records, totalCount }),
    };

  } catch (err) {
    if (err.name === 'AbortError') {
      return {
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'Request timed out. Try a smaller radius.' }),
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Proxy fetch failed' }),
    };
  }
};
