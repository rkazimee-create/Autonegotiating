exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY not set.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { vehicle, msrp, purchaseType, condition, mileage, conditionLabel, vin } = body;
  if (!vehicle) return { statusCode: 400, headers, body: JSON.stringify({ error: 'vehicle is required' }) };

  const fmt = n => '$' + Math.round(n).toLocaleString();
  const isUsed = condition === 'used' || condition === 'cpo';
  const condStr = conditionLabel || (isUsed ? 'Used' : 'New');
  const mileageStr = mileage > 0 ? ' with ' + Number(mileage).toLocaleString() + ' miles' : '';
  const priceRef = msrp > 0 ? ' listed at ' + fmt(msrp) : '';
  const vinStr = vin ? ' (VIN: ' + vin + ')' : '';

  const fairValueSearch = isUsed
    ? 'Search KBB.com, Edmunds.com, and CarGurus.com for the fair market value of this ' + condStr + ' ' + vehicle + mileageStr + '. Find the private party value, dealer retail value, and trade-in value ranges. Also check Carfax for any reported accidents or issues if VIN is available.'
    : 'Search for current dealer pricing and any manufacturer incentives for the new ' + vehicle + '.';

  const usedContext = isUsed
    ? 'This is a ' + condStr + ' vehicle' + mileageStr + vinStr + '. ' + fairValueSearch + ' Factor depreciation and mileage into offer strategy.'
    : 'This is a NEW vehicle. Check for current dealer markups/discounts and manufacturer incentives.';

  const jsonTemplate = '{"summary":"2-3 sentences","fairMarketValue":{"kbb":{"privateParty":0,"dealerRetail":0,"tradeIn":0},"edmunds":{"tmv":0}},"deals":[{"source":"Reddit","price":0,"description":"brief","tags":["tag"]}],"marketStats":{"avgTransactionPrice":0,"lowestReported":0,"highestReported":0,"avgDiscountOffMsrp":0,"avgDiscountPercent":0,"bestMonthToBuy":"Month","daysOnLot":"30"},"offerStrategy":{"aggressive":{"price":0,"label":"Aggressive","desc":"brief"},"recommended":{"price":0,"label":"Recommended","desc":"brief"},"safe":{"price":0,"label":"Safe","desc":"brief"}},"negotiationTips":["tip1","tip2","tip3"],"sources":["source1"]}';

  const prompt = [
    'You are an automotive deal intelligence agent.',
    'Do up to 3 web searches to find: fair market value (KBB/Edmunds) and real transaction prices (Reddit r/askcarsales, Edmunds forums) for a ' + condStr + ' ' + vehicle + mileageStr + (priceRef ? ', ' + priceRef : '') + (vinStr || '') + '.',
    'Purchase type: ' + (purchaseType || 'cash') + '. ' + usedContext,
    'Return ONLY a JSON object matching this structure (no markdown): ' + jsonTemplate
  ].join(' ');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Anthropic error ' + res.status);

    const textBlock = data.content?.find(b => b.type === 'text');
    const raw = textBlock?.text || '';

    let parsed = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch(e) {
      console.error('JSON parse error:', e.message);
    }

    console.log('Parsed:', !!parsed);
    if (parsed?.offerStrategy) console.log('Recommended:', parsed.offerStrategy.recommended?.price);

    return { statusCode: 200, headers, body: JSON.stringify({ raw, parsed, success: !!parsed }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
