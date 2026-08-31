import { completeJSON } from './llmClient.js';

const EXTRACTION_PROMPT = `You are an OCR system for Indian payment receipts and payment app screenshots.
Analyse this payment screenshot carefully and extract the following fields.
Return ONLY a valid JSON object with no extra text, markdown, or explanation.

{
  "amount": <number or null — the payment amount in rupees as a plain number, e.g. 5000, without commas or currency symbol>,
  "transactionId": <string or null — UPI Reference Number, UTR, Txn ID, Transaction ID, Order ID, or any reference code>,
  "date": <string or null — date of the transaction in DD/MM/YYYY format>,
  "paymentStatus": <"SUCCESS" | "FAILED" | "UNKNOWN" — "SUCCESS" if the payment went through (Paid/Debited/Sent/Successful), "FAILED" if it failed/reversed/declined, "UNKNOWN" if not determinable>,
  "rawText": <string — all visible text found in the screenshot, concatenated with spaces>
}

Rules:
- amount: Look for ₹, Rs, INR symbols or words like "Amount", "Total", "Paid", "You paid", "Debited". Return the numeric value only.
- transactionId: Look for "UTR", "UPI Ref", "Reference No", "Txn ID", "Transaction ID", "Order ID", "Payment ID". Include the alphanumeric code.
- date: Convert any date format you find to DD/MM/YYYY. Look for transaction date, payment date.
- paymentStatus: Use all context — success badges, status text, color descriptions are not available so focus on text like "Payment Successful", "Money Sent", "Paid", "Failed", "Reversed".
- If a field is genuinely not visible/readable, return null for that field.
- Return ONLY the JSON. No other text.`;

/**
 * Extracts the fare/amount from a ride-hailing app screenshot (Ola, Uber, Rapido).
 * Returns: { amount, confidence }
 */
export async function extractRideFare(imageBuffer, mimeType = 'image/jpeg', { expectedFrom, expectedTo, expectedRideType } = {}) {
  const verifySection = (expectedFrom || expectedTo || expectedRideType)
    ? `\nAlso verify these details against the screenshot:
- Expected pickup: "${expectedFrom || 'not provided'}"
- Expected drop: "${expectedTo || 'not provided'}"
- Expected ride type: "${expectedRideType || 'not provided'}" (Bike/Auto/Cab)
Add these fields to the JSON:
  "locationMatch": <true if pickup/drop areas roughly match the screenshot locations, false otherwise>,
  "rideTypeMatch": <true if the ride type in screenshot matches expected, false otherwise>,
  "screenshotPickup": <actual pickup shown in screenshot or null>,
  "screenshotDrop": <actual drop shown in screenshot or null>`
    : '';

  const rideTypeHint = expectedRideType
    ? `\nIMPORTANT: The user selected ride type "${expectedRideType}". If the screenshot shows multiple ride options (e.g. Bike, Auto, Cab/Sedan/Go), extract the fare for the "${expectedRideType}" category:
- If "${expectedRideType}" is "Bike": look for Bike Saver, Moto, Bike, Rapido Bike, etc.
- If "${expectedRideType}" is "Cab": look for Uber Go, Go Sedan, Premier, Ola Mini, Ola Prime, sedan, hatchback, cab options — NOT Bike/Moto/Auto.
- If "${expectedRideType}" is "Auto": look for Auto, Auto Rickshaw options.
Pick the cheapest option within the matching category. If no option matches the expected ride type, still return the closest match but set rideTypeMatch to false.`
    : '';

  const prompt = `You are extracting the total fare from a ride-hailing app screenshot (Ola, Uber, Rapido, etc).
Look for the total fare, bill amount, or amount charged for the ride.
Return ONLY a valid JSON object with no extra text:
{
  "amount": <number in rupees as plain number, e.g. 245, or null if not found>,
  "confidence": <"high" | "medium" | "low">
}
Rules:
- Look for labels like "Total", "Fare", "Bill Amount", "Amount Charged", "Total Fare", "Your fare", "Trip fare"
- Return the final total amount after all discounts and surcharges
- Return null if you cannot find a clear fare amount
- Return ONLY the JSON, no other text${rideTypeHint}${verifySection}`;

  const { data: parsed } = await completeJSON({
    text: prompt,
    files: [{ buffer: imageBuffer, mimetype: mimeType }],
    maxTokens: 256,
    purpose: 'ocr',
  });

  if (!parsed) {
    return { amount: null, confidence: 'low', locationMatch: null, rideTypeMatch: null };
  }

  const amount = typeof parsed.amount === 'number' ? parsed.amount
    : parsed.amount != null ? parseFloat(String(parsed.amount).replace(/,/g, '')) || null
    : null;

  return {
    amount,
    confidence: parsed.confidence || 'low',
    locationMatch: parsed.locationMatch ?? null,
    rideTypeMatch: parsed.rideTypeMatch ?? null,
    screenshotPickup: parsed.screenshotPickup || null,
    screenshotDrop: parsed.screenshotDrop || null,
  };
}

/**
 * Sends image buffer to Claude Vision API and extracts payment receipt fields.
 * Handles both image types and PDFs (using Claude's native document block for PDF).
 * Returns: { rawText, transactionId, amount, date, paymentStatus, ocrConfidence }
 */
export async function extractReceiptData(imageBuffer, mimeType = 'image/jpeg') {
  // PDFs and images are both handled by the provider layer, which routes each
  // to the right attachment type for whichever vendor is configured.
  const { data } = await completeJSON({
    text: EXTRACTION_PROMPT,
    files: [{ buffer: imageBuffer, mimetype: mimeType }],
    maxTokens: 1024,
    purpose: 'ocr',
  });

  // An unreadable response is not fatal: every field comes back null, OCR
  // confidence is 0, and the expense falls to manual review rather than failing
  // the employee's submission.
  const parsed = data || {};

  const amount = typeof parsed.amount === 'number' ? parsed.amount
    : parsed.amount != null ? parseFloat(String(parsed.amount).replace(/,/g, '')) || null
    : null;

  // Compute OCR confidence based on how many fields were successfully extracted
  const fieldsFound = [
    amount != null,
    parsed.transactionId != null,
    parsed.date != null,
    parsed.paymentStatus != null && parsed.paymentStatus !== 'UNKNOWN',
  ].filter(Boolean).length;

  const ocrConfidence = Math.round((fieldsFound / 4) * 100); // 0, 25, 50, 75, or 100

  return {
    rawText: parsed.rawText || '',
    transactionId: parsed.transactionId || null,
    amount,
    date: parsed.date || null,
    paymentStatus: parsed.paymentStatus || 'UNKNOWN',
    ocrConfidence,
  };
}
