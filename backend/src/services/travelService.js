import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ── Google Maps: get distance in km ──────────────────────────────────────────

async function getDistanceKm(from, to) {
  if (!MAPS_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&key=${MAPS_KEY}&units=metric`;
    const res = await fetch(url);
    const data = await res.json();
    const meters = data?.rows?.[0]?.elements?.[0]?.distance?.value;
    return meters ? Math.round(meters / 1000) : null;
  } catch (e) {
    console.warn('Google Maps API failed:', e.message);
    return null;
  }
}

// ── Flight / Train / Bus — Claude with web search for real-time prices ────────

async function searchWebForFare(query) {
  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${MAPS_KEY}&cx=a352a1074c0264ef1&q=${encodeURIComponent(query)}&num=5`);
    const data = await res.json();
    return (data.items || []).map(item => `${item.title}: ${item.snippet}`).join('\n');
  } catch (e) {
    console.warn('Web search failed:', e.message);
    return '';
  }
}

export async function estimatePublicTransportCost({ from, to, mode, travelDate, peopleCount = 1 }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const dateStr = travelDate || new Date().toISOString().split('T')[0];
  const peopleStr = peopleCount > 1 ? `\nNumber of people: ${peopleCount} (provide total for all)` : '';

  // Search web for real-time prices
  let searchQuery = '';
  if (mode === 'Flight') {
    searchQuery = `cheapest flight ${from} to ${to} ${dateStr} economy fare price INR`;
  } else if (mode === 'Train') {
    searchQuery = `train fare ${from} to ${to} 3AC tatkal price IRCTC ${dateStr}`;
  } else {
    searchQuery = `${mode} fare ${from} to ${to} price INR ${dateStr}`;
  }

  const webResults = await searchWebForFare(searchQuery);
  const webContext = webResults
    ? `\nHere are real-time search results for current fares:\n${webResults}\n\nUse these results to give the most accurate fare.`
    : '\nNo web results found. Use your best knowledge of current Indian fares.';

  const prompt = `You are a travel cost estimator for an Indian corporate expense system.

Mode: ${mode}
From: ${from}
To: ${to}
Travel Date: ${dateStr} (THIS IS THE ACTUAL TRAVEL DATE — estimate fare for THIS date, NOT advance booking)${peopleStr}
${webContext}

IMPORTANT:
- The travel date is ${dateStr}. Give the fare for booking on/near this date.
- For FLIGHTS: Last-minute/same-week economy fares are HIGHER than advance fares. A Delhi-Bangalore flight booked 1-2 days before typically costs ₹6,000-₹10,000, not ₹3,000-₹4,000.
- For TRAINS: Use tatkal fare if travel is within 1-2 days. Use regular 3AC fare for advance booking.
- Be realistic about last-minute pricing. Do NOT give advance booking prices for near-term travel.
- Give ONE specific amount, not a range.

Return ONLY this JSON:
{
  "estimated_amount": <total fare in rupees as integer>,
  "per_person_amount": <per person fare as integer>,
  "reasoning": "<specific explanation mentioning airline/train, class, and why this price>"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0]?.text?.trim() || '{}';
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      estimatedAmount: parsed.estimated_amount,
      perPersonAmount: parsed.per_person_amount,
      distanceKm: null,
      mode,
      reasoning: parsed.reasoning,
    };
  } catch (e) {
    console.warn('Claude transport estimate failed:', e.message);
    return {
      estimatedAmount: 500 * peopleCount,
      perPersonAmount: 500,
      distanceKm: null,
      mode,
      reasoning: 'Fallback estimate — please edit if needed',
    };
  }
}

// ── Claude fallback: estimate distance when Google Maps fails ─────────────────

async function getDistanceKmWithFallback(from, to) {
  const mapsResult = await getDistanceKm(from, to);
  if (mapsResult) return mapsResult;

  // Fallback: ask Claude Haiku to estimate the distance
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Estimate the road distance in kilometres between these two locations in India:
From: ${from}
To: ${to}

Return ONLY a JSON object with no other text:
{"distance_km": <integer>}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0]?.text?.trim() || '{}';
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    return parsed.distance_km ? Math.round(parsed.distance_km) : null;
  } catch (e) {
    console.warn('Claude distance fallback failed:', e.message);
    return null;
  }
}

// ── Contractual Cab — distance × ₹10/km ──────────────────────────────────────

export async function estimateContractualCabCost({ from, to, peopleCount = 1 }) {
  const RATE_PER_KM = 10;
  const distanceKm = await getDistanceKmWithFallback(from, to);

  const estimatedAmount = distanceKm
    ? Math.round(distanceKm * RATE_PER_KM)
    : null;

  return {
    estimatedAmount,
    perPersonAmount: estimatedAmount ? Math.round(estimatedAmount / peopleCount) : null,
    distanceKm,
    ratePerKm: RATE_PER_KM,
    mode: 'Contractual Cab',
    reasoning: distanceKm
      ? `${distanceKm} km × ₹${RATE_PER_KM}/km = ₹${estimatedAmount}`
      : 'Distance not found — please enter amount manually',
  };
}

// ── Own Vehicle (Bike/Car) — distance × fixed rate ────────────────────────────

export async function estimateOwnVehicleCost({ from, to, vehicleType = 'Bike' }) {
  const RATE = vehicleType === 'Car' ? 10 : 8;
  const distanceKm = await getDistanceKmWithFallback(from, to);

  const estimatedAmount = distanceKm
    ? Math.round(distanceKm * RATE)
    : null;

  return {
    estimatedAmount,
    perPersonAmount: estimatedAmount,
    distanceKm,
    ratePerKm: RATE,
    mode: vehicleType,
    reasoning: distanceKm
      ? `${distanceKm} km × ₹${RATE}/km (${vehicleType}) = ₹${estimatedAmount}`
      : 'Distance not found — please enter amount manually',
  };
}

// ── Legacy: general Gemini-based estimate (kept for backward compat) ──────────

export async function estimateTravelCost(from, to, peopleCount = 1) {
  const distanceKm = await getDistanceKm(from, to);
  const RATE_PER_KM = parseFloat(process.env.IMPREST_TRAVEL_RATE_PER_KM || '8');

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are a travel cost estimator for construction site engineers in India.
Calculate the minimum GENUINE travel cost for:
- From: ${from}
- To: ${to}
- Number of people: ${peopleCount}
${distanceKm ? `- Distance: approximately ${distanceKm} km` : ''}

Consider: local train, metro, bus, shared auto, or cheapest reasonable mode.
Do NOT suggest flights or luxury transport.
Respond in this exact JSON format only, no other text:
{
  "estimated_amount": <number in rupees, total for all people>,
  "per_person_amount": <number>,
  "mode": "<most likely transport mode>",
  "reasoning": "<1 sentence explanation>"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      estimatedAmount: parsed.estimated_amount,
      perPersonAmount: parsed.per_person_amount,
      distanceKm,
      mode: parsed.mode,
      reasoning: parsed.reasoning,
    };
  } catch {
    const fallbackAmount = distanceKm
      ? Math.round(distanceKm * RATE_PER_KM * peopleCount)
      : 500 * peopleCount;
    return {
      estimatedAmount: fallbackAmount,
      perPersonAmount: Math.round(fallbackAmount / peopleCount),
      distanceKm,
      mode: 'estimated',
      reasoning: 'Calculated at ₹' + RATE_PER_KM + '/km',
    };
  }
}
