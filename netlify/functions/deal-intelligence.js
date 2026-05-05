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

  const vq = condStr + ' ' + vehicle + mileageStr;
  const yr = new Date().getFullYear();

  const searches = isUsed ? [
    vehicle + ' fair purchase price OR fair market value site:kbb.com',
    vehicle + ' average listing price OR market average site:cargurus.com',
    vehicle + ' true market value OR TMV site:edmunds.com',
  ] : [
    vehicle + ' fair purchase price OR dealer retail value site:kbb.com',
    vehicle + ' average listing price OR market average site:cargurus.com',
    vehicle + ' true market value TMV OR incentives site:edmunds.com',
  ];

  // Template uses only empty/zero placeholders — no instructional text the model might imitate
  const jsonTemplate = JSON.stringify({
    summary: '',
    fairMarketValue: { kbb: { dealerRetail: 0 }, edmunds: { tmv: 0 }, cargurus: { avgListing: 0 } },
    deals: [
      { source: 'KBB',      price: 0, description: '', url: '', tags: [] },
      { source: 'CarGurus', price: 0, description: '', url: '', tags: [] },
      { source: 'Edmunds',  price: 0, description: '', url: '', tags: [] },
    ],
    marketStats: { avgTransactionPrice: 0, lowestReported: 0, highestReported: 0, avgDiscountOffMsrp: 0, avgDiscountPercent: 0, bestMonthToBuy: '', daysOnLot: '' },
    offerStrategy: {
      aggressive:   { price: 0, label: 'Aggressive',   desc: '' },
      recommended:  { price: 0, label: 'Recommended',  desc: '' },
      safe:         { price: 0, label: 'Safe',         desc: '' },
    },
    negotiationTips: ['', '', '', '', ''],
    sources: [],
  });

  const prompt = `You are an automotive deal intelligence agent researching the ${condStr} ${vehicle}${mileageStr}${priceRef ? ', ' + priceRef : ''}${vinStr}. Purchase type: ${purchaseType || 'cash'}.

STEP 1 — Run this web search: ${searches[0]}
STEP 2 — Run this web search: ${searches[1]}
STEP 3 — Run this web search: ${searches[2]}

After completing all searches, fill in the JSON below using ONLY information found in the search results. Rules:
- "summary": 3-4 sentences summarizing what you actually found about this specific vehicle's market and pricing.
- "deals": There are exactly 3 slots, one per source (KBB, CarGurus, Edmunds). For each, find a REAL pricing insight or buyer report from that source. "price" = the dollar amount shown or paid, "description" = 2-3 sentences describing what that source shows for this vehicle — quote the actual figure, market rating, or buyer experience found in search results. "url" = the actual page URL. Leave description empty only if you found absolutely nothing for that source.
- "fairMarketValue": Fill kbb.dealerRetail from KBB fair purchase price or dealer retail, edmunds.tmv from Edmunds True Market Value, cargurus.avgListing from CarGurus average listing price. Leave at 0 only if not found.
- "marketStats": Fill with real aggregated data from search results.
- "offerStrategy": Based on the real data found, recommend specific dollar amounts for this vehicle.
- "negotiationTips": Write tips specific to buying a ${vehicle} — reference what you found in the searches (e.g. specific incentives, dealer behavior patterns, regional pricing).
- "sources": List the actual URLs you found useful.

Return ONLY the completed JSON (no markdown, no explanation): ${jsonTemplate}`;

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
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: 'You are an automotive deal intelligence agent. You MUST use web search to find real data before answering. NEVER fabricate quotes, deals, or prices from your training data. If a web search returns no results for a source, leave that deal entry blank. Every "description" field must be based on something you actually found in a web search result — quote or paraphrase the real post. Identical or generic descriptions like "Reported getting about 3-4% off MSRP" are unacceptable.',
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Anthropic error ' + res.status);

    // Model emits a short text block before searches, then the JSON in a final text block.
    // Use the last text block so we get the JSON, not the pre-search commentary.
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const raw = textBlocks.map(b => b.text).join('');

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
