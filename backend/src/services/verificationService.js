import { extractReceiptData } from './visionService.js';

const AMOUNT_TOLERANCE = parseFloat(process.env.AMOUNT_TOLERANCE_INR || '10');
const DATE_TOLERANCE_DAYS = parseInt(process.env.DATE_TOLERANCE_DAYS || '2');
const AUTO_APPROVE_THRESHOLD = parseFloat(process.env.CONFIDENCE_AUTO_APPROVE || '94');
const MANUAL_REVIEW_THRESHOLD = parseFloat(process.env.CONFIDENCE_MANUAL_REVIEW || '70');

/**
 * Runs OCR on the image and validates extracted data against the submission.
 *
 * Returns:
 * {
 *   ocrData: { rawText, transactionId, amount, date, paymentStatus, ocrConfidence },
 *   checks: Array<{ step, result, score, detail }>,
 *   overallConfidence: number (0-100),
 *   autoAction: 'auto_verified' | 'manual_review' | 'blocked',
 * }
 */
export async function verifyExpense(imageBuffer, submission) {
  // submission = { amount: number, submittedAt: ISO string, mimeType?: string }
  const ocrData = await extractReceiptData(imageBuffer, submission.mimeType);
  const checks = [];

  // CHECK 1 — Amount match (weight: 40 points)
  const amountCheck = checkAmount(ocrData.amount, submission.amount);
  checks.push({ step: 'amount_check', ...amountCheck });

  // CHECK 2 — Date reasonable (weight: 20 points)
  const dateCheck = checkDate(ocrData.date, submission.submittedAt);
  checks.push({ step: 'date_check', ...dateCheck });

  // CHECK 3 — Payment status = SUCCESS (weight: 30 points)
  const statusCheck = checkPaymentStatus(ocrData.paymentStatus);
  checks.push({ step: 'status_check', ...statusCheck });

  // CHECK 4 — Transaction ID format valid (weight: 10 points)
  const txnCheck = checkTransactionId(ocrData.transactionId);
  checks.push({ step: 'txn_id_check', ...txnCheck });

  // Weighted score (0-100)
  const weightedScore =
    amountCheck.score * 40 +
    dateCheck.score * 20 +
    statusCheck.score * 30 +
    txnCheck.score * 10;

  // Blend verification quality with OCR read quality
  const overallConfidence = Math.round(weightedScore * 0.7 + ocrData.ocrConfidence * 0.3);

  let autoAction;
  if (overallConfidence >= AUTO_APPROVE_THRESHOLD) {
    autoAction = 'auto_verified';
  } else if (overallConfidence >= MANUAL_REVIEW_THRESHOLD) {
    autoAction = 'manual_review';
  } else {
    autoAction = 'blocked';
  }

  return { ocrData, checks, overallConfidence, autoAction };
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkAmount(ocrAmount, submittedAmount) {
  if (ocrAmount == null) {
    return { result: 'fail', score: 0, detail: 'Amount not found in receipt' };
  }

  const diff = Math.abs(ocrAmount - submittedAmount);

  if (diff <= AMOUNT_TOLERANCE) {
    return {
      result: 'pass',
      score: 1,
      detail: `Match: OCR ₹${ocrAmount} vs submitted ₹${submittedAmount} (diff ₹${diff.toFixed(2)})`,
    };
  }

  if (diff <= AMOUNT_TOLERANCE * 3) {
    return {
      result: 'warn',
      score: 0.5,
      detail: `Near match: OCR ₹${ocrAmount} vs submitted ₹${submittedAmount} (diff ₹${diff.toFixed(2)})`,
    };
  }

  return {
    result: 'fail',
    score: 0,
    detail: `Mismatch: OCR ₹${ocrAmount} vs submitted ₹${submittedAmount} (diff ₹${diff.toFixed(2)})`,
  };
}

function checkDate(ocrDateStr, submittedAt) {
  if (!ocrDateStr) {
    return { result: 'warn', score: 0.5, detail: 'Date not found in receipt' };
  }

  try {
    // Normalise DD/MM/YYYY → parseable
    let normalised = ocrDateStr.trim();

    // Convert DD/MM/YYYY or DD-MM-YYYY to MM/DD/YYYY for Date.parse
    const dmyMatch = normalised.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      const year = y.length === 2 ? `20${y}` : y;
      normalised = `${m}/${d}/${year}`;
    }

    const ocrDate = new Date(normalised);
    const submitDate = new Date(submittedAt);

    if (isNaN(ocrDate.getTime())) {
      return { result: 'warn', score: 0.4, detail: `Could not parse date: "${ocrDateStr}"` };
    }

    const diffDays = Math.abs((submitDate - ocrDate) / (1000 * 60 * 60 * 24));

    if (diffDays <= DATE_TOLERANCE_DAYS) {
      return {
        result: 'pass',
        score: 1,
        detail: `Date OK: "${ocrDateStr}" (${diffDays.toFixed(1)} days from submission)`,
      };
    }

    return {
      result: 'fail',
      score: 0,
      detail: `Date too far: "${ocrDateStr}" is ${diffDays.toFixed(1)} days from submission date`,
    };
  } catch {
    return { result: 'warn', score: 0.3, detail: 'Date parsing error' };
  }
}

function checkPaymentStatus(status) {
  switch (status) {
    case 'SUCCESS':
      return { result: 'pass', score: 1, detail: 'Receipt confirms payment SUCCESS' };
    case 'FAILED':
      return { result: 'fail', score: 0, detail: 'Receipt shows payment FAILED' };
    default:
      return { result: 'warn', score: 0.4, detail: 'Payment status unclear in receipt' };
  }
}

function checkTransactionId(txnId) {
  if (!txnId) {
    return { result: 'warn', score: 0.5, detail: 'Transaction ID not found in receipt' };
  }

  // Valid: 10-22 alphanumeric characters
  const valid = /^[A-Z0-9]{10,22}$/i.test(txnId);

  return valid
    ? { result: 'pass', score: 1, detail: `Valid Transaction ID: ${txnId}` }
    : { result: 'warn', score: 0.6, detail: `Unusual Transaction ID format: ${txnId}` };
}
