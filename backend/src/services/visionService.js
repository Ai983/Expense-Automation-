import Anthropic from '@anthropic-ai/sdk';

let anthropicClient;

function getClient() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

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
export async function extractRideFare(imageBuffer, mimeType = 'image/jpeg') {
  const client = getClient();
  const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mediaType = supportedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

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
- Return ONLY the JSON, no other text`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const raw = response.content[0]?.text?.trim() || '{}';
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const amount = typeof parsed.amount === 'number' ? parsed.amount
      : parsed.amount != null ? parseFloat(String(parsed.amount).replace(/,/g, '')) || null
      : null;
    return { amount, confidence: parsed.confidence || 'low' };
  } catch {
    return { amount: null, confidence: 'low' };
  }
}

/**
 * Sends image buffer to Claude Vision API and extracts payment receipt fields.
 * Handles both image types and PDFs (using Claude's native document block for PDF).
 * Returns: { rawText, transactionId, amount, date, paymentStatus, ocrConfidence }
 */
export async function extractReceiptData(imageBuffer, mimeType = 'image/jpeg') {
  const client = getClient();

  // Route PDFs to document block, images to image block
  let contentBlock;
  if (mimeType === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: imageBuffer.toString('base64'),
      },
    };
  } else {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mediaType = supportedTypes.includes(mimeType) ? mimeType : 'image/jpeg';
    contentBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: imageBuffer.toString('base64'),
      },
    };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  const raw = response.content[0]?.text?.trim() || '{}';

  // Strip any markdown code fences Claude might add despite the prompt
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn('Claude Vision returned non-JSON:', raw);
    parsed = {};
  }

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
