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

  const vin = (event.queryStringParameters || {}).vin || '';
  if (!vin || vin.length !== 17) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'VIN must be exactly 17 characters.' }) };
  }

  try {
    const res = await fetch('https://api.auto.dev/vin/' + encodeURIComponent(vin), {
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Auto.dev VIN error ' + res.status);

    // Normalize the response — Auto.dev returns flat fields at top level
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        vin: data.vin,
        year: data.vehicle?.year || null,
        make: data.make || '',
        model: data.model || '',
        trim: data.trim || '',
        body: data.body || data.style || '',
        engine: data.engine || '',
        drive: data.drive || '',
        transmission: data.transmission || '',
        valid: data.vinValid || false,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
