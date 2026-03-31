import { GoogleGenerativeAI } from '@google/generative-ai';

const RATE_PER_KM = parseFloat(process.env.IMPREST_TRAVEL_RATE_PER_KM || '8');
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

export async function estimateTravelCost(from, to, peopleCount = 1) {
  let distanceKm = null;

  // Step 1: Get distance via Google Maps Distance Matrix
  if (MAPS_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&key=${MAPS_KEY}&units=metric`;
      const res = await fetch(url);
      const data = await res.json();
      const meters = data?.rows?.[0]?.elements?.[0]?.distance?.value;
      if (meters) distanceKm = Math.round(meters / 1000);
    } catch (e) {
      console.warn('Google Maps API failed:', e.message);
    }
  }

  // Step 2: AI cost reasoning via Gemini
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
  } catch (e) {
    // Fallback: simple km-based calculation
    const fallbackAmount = distanceKm
      ? Math.round(distanceKm * RATE_PER_KM * peopleCount)
      : 500 * peopleCount; // ₹500/person default if no data
    return {
      estimatedAmount: fallbackAmount,
      perPersonAmount: Math.round(fallbackAmount / peopleCount),
      distanceKm,
      mode: 'estimated',
      reasoning: 'Calculated at ₹' + RATE_PER_KM + '/km',
    };
  }
}
