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

  const vin = (event.queryStringParameters || {}).vin;
  if (!vin) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'VIN is required.' }) };
  }

  // Try v2 endpoint first, fall back to v1
  const urls = [
    `https://api.auto.dev/vin/${encodeURIComponent(vin)}/intelligence`,
    `https://auto.dev/api/vin/${encodeURIComponent(vin)}/intelligence`,
  ];

  for (const url of urls) {
    try {
      console.log('Trying intelligence URL:', url);
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        console.log('Response not ok:', res.status, 'for', url);
        continue;
      }

      const data = await res.json();
      console.log('Intelligence keys:', Object.keys(data));
      console.log('Intelligence data:', JSON.stringify(data).slice(0, 1000));

      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
      console.log('Error with', url, ':', err.message);
    }
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'No intelligence data available for this VIN.' }) };
};
