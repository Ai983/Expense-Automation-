import { extractReceiptData } from './visionService.js';
import {
  AMOUNT_TOLERANCE_INR as AMOUNT_TOLERANCE,
  CONFIDENCE_AUTO_APPROVE as AUTO_APPROVE_THRESHOLD,
  CONFIDENCE_MANUAL_REVIEW as MANUAL_REVIEW_THRESHOLD,
  RECEIPT_PREDATE_GRACE_DAYS,
  RECEIPT_FUTURE_GRACE_DAYS,
  RECEIPT_ORPHAN_MAX_AGE_DAYS,
} from '../config/constants.js';

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
  // submission = { amount, submittedAt, mimeType?, imprestPaidAt? }
  const ocrData = await extractReceiptData(imageBuffer, submission.mimeType);
  const checks = [];

  // CHECK 1 — Amount match (weight: 40 points)
  const amountCheck = checkAmount(ocrData.amount, submission.amount);
  checks.push({ step: 'amount_check', ...amountCheck });

  // CHECK 2 — Receipt date falls inside the imprest period (weight: 20 points)
  const dateCheck = checkDate(ocrData.date, submission.submittedAt, submission.imprestPaidAt);
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

/**
 * Validates the receipt date against the imprest period rather than the
 * submission date.
 *
 * Employees have 7 days to file expenses and routinely batch a week of receipts
 * at once. The previous rule (receipt within 2 days of submission) treated that
 * normal behaviour as a failure — it failed 134 of 141 backlog expenses while
 * 139 of those same 141 passed the amount check. It was measuring the wrong
 * thing.
 *
 * The valid window is: the advance was paid (minus a grace period for spending
 * out of pocket beforehand, which is permitted company practice) through to
 * submission. Only receipts genuinely outside that window fail.
 */
function checkDate(ocrDateStr, submittedAt, imprestPaidAt) {
  if (!ocrDateStr) {
    return { result: 'warn', score: 0.5, detail: 'Date not found in receipt' };
  }

  try {
    let normalised = ocrDateStr.trim();

    // DD/MM/YYYY or DD-MM-YYYY → MM/DD/YYYY for Date.parse
    const dmyMatch = normalised.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      const year = y.length === 2 ? `20${y}` : y;
      normalised = `${m}/${d}/${year}`;
    }

    const receiptDate = new Date(normalised);
    const submitDate = new Date(submittedAt);

    if (isNaN(receiptDate.getTime())) {
      return { result: 'warn', score: 0.4, detail: `Could not parse date: "${ocrDateStr}"` };
    }

    const DAY = 1000 * 60 * 60 * 24;
    const daysAfterSubmission = (receiptDate - submitDate) / DAY;

    // A receipt dated after submission is a device clock error or a wrong file.
    if (daysAfterSubmission > RECEIPT_FUTURE_GRACE_DAYS) {
      return {
        result: 'fail',
        score: 0,
        detail: `Receipt dated "${ocrDateStr}" is ${daysAfterSubmission.toFixed(1)} days AFTER submission`,
      };
    }

    // No linked imprest (legacy rows): fall back to an age check on submission.
    if (!imprestPaidAt) {
      const ageDays = (submitDate - receiptDate) / DAY;
      if (ageDays <= RECEIPT_ORPHAN_MAX_AGE_DAYS) {
        return {
          result: 'pass',
          score: 1,
          detail: `Date OK: "${ocrDateStr}" (${ageDays.toFixed(0)} days before submission, no linked imprest)`,
        };
      }
      return {
        result: 'warn',
        score: 0.4,
        detail: `Receipt "${ocrDateStr}" is ${ageDays.toFixed(0)} days old with no linked imprest`,
      };
    }

    const paidDate = new Date(imprestPaidAt);
    const daysBeforePayout = (paidDate - receiptDate) / DAY;

    // Spent after the advance landed — the ordinary case.
    if (daysBeforePayout <= 0) {
      return {
        result: 'pass',
        score: 1,
        detail: `Date OK: "${ocrDateStr}" falls within the imprest period`,
      };
    }

    // Spent out of pocket before the advance arrived — permitted practice.
    if (daysBeforePayout <= RECEIPT_PREDATE_GRACE_DAYS) {
      return {
        result: 'pass',
        score: 1,
        detail: `Date OK: "${ocrDateStr}" is ${daysBeforePayout.toFixed(0)} days before payout (out-of-pocket claim, allowed)`,
      };
    }

    return {
      result: 'warn',
      score: 0.3,
      detail: `Receipt "${ocrDateStr}" predates the advance by ${daysBeforePayout.toFixed(0)} days — outside the allowed window`,
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
