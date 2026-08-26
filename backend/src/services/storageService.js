import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/supabase.js';
import { STORAGE_BUCKET, SIGNED_URL_EXPIRY_SECONDS } from '../config/constants.js';
import { resolveMimeType, extensionForMime } from '../utils/fileType.js';

// Legacy client — reads old Finance project storage for the 850 pre-migration screenshots.
// New uploads always go to Hub. This client is read-only (used only for getSignedUrl fallback).
const legacyStorageClient = process.env.LEGACY_SUPABASE_URL && process.env.LEGACY_SERVICE_ROLE_KEY
  ? createClient(process.env.LEGACY_SUPABASE_URL, process.env.LEGACY_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const LEGACY_BUCKET = process.env.LEGACY_STORAGE_BUCKET ?? 'expense-screenshots';

// Cut-over timestamp: rows created before this date have files in the legacy project.
// Update this to the exact moment Hub went live as primary storage.
const STORAGE_CUTOVER_DATE = new Date(process.env.STORAGE_CUTOVER_DATE ?? '2026-05-22T00:00:00Z');

/**
 * Uploads an image buffer to Hub Supabase Storage.
 * Returns the storage path (not a public URL — use getSignedUrl to access).
 */
export async function uploadScreenshot(buffer, mimeType, employeeId, refId) {
  if (!buffer?.length) {
    throw new Error('Screenshot upload failed: file is empty');
  }

  // The bytes decide the type — a mislabelled file must not be stored under a
  // misleading extension or Content-Type (see utils/fileType.js).
  const actualType = resolveMimeType(buffer, mimeType);
  const ext = extensionForMime(actualType);
  const storagePath = `${employeeId}/${refId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: actualType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Screenshot upload failed: ${error.message}`);
  }

  return storagePath;
}

/**
 * Generates a time-limited signed URL for viewing a screenshot.
 * Falls back to the legacy (old Finance project) storage if the file pre-dates Hub cutover.
 */
export async function getSignedUrl(storagePath, createdAt) {
  if (!storagePath) return null;

  // Determine whether this file lives in Hub storage or legacy storage.
  const isLegacy = legacyStorageClient && createdAt && new Date(createdAt) < STORAGE_CUTOVER_DATE;

  const client = isLegacy ? legacyStorageClient : supabaseAdmin;
  const bucket = isLegacy ? LEGACY_BUCKET : STORAGE_BUCKET;

  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    // If Hub lookup fails and we have a legacy client, try legacy as final fallback.
    if (!isLegacy && legacyStorageClient) {
      const { data: fallbackData } = await legacyStorageClient.storage
        .from(LEGACY_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
      if (fallbackData?.signedUrl) return fallbackData.signedUrl;
    }
    console.error('Failed to generate signed URL:', error.message);
    return null;
  }

  return data.signedUrl;
}

/**
 * Downloads a stored screenshot as a Buffer.
 *
 * Used by the AI auditor when it re-audits an expense outside the submit
 * request (sweeper / backlog), where the original upload buffers are long gone.
 * Mirrors getSignedUrl's legacy-bucket fallback so pre-cutover files still
 * resolve. Returns null rather than throwing — a missing file must degrade the
 * audit to human review, not crash the sweeper.
 */
export async function downloadScreenshot(storagePath, createdAt) {
  if (!storagePath) return null;

  const isLegacy = legacyStorageClient && createdAt && new Date(createdAt) < STORAGE_CUTOVER_DATE;

  const attempts = isLegacy
    ? [[legacyStorageClient, LEGACY_BUCKET]]
    : [[supabaseAdmin, STORAGE_BUCKET], ...(legacyStorageClient ? [[legacyStorageClient, LEGACY_BUCKET]] : [])];

  const failures = [];
  for (const [client, bucket] of attempts) {
    try {
      const { data, error } = await client.storage.from(bucket).download(storagePath);
      if (error || !data) {
        failures.push(`${bucket}: ${error?.message || 'empty response'}`);
        continue;
      }
      return Buffer.from(await data.arrayBuffer());
    } catch (err) {
      failures.push(`${bucket}: ${err.message}`);
    }
  }

  console.warn(`Could not download ${storagePath} — ${failures.join(' | ')}`);
  return null;
}

/**
 * Uploads a payment receipt to Supabase Storage.
 */
export async function uploadPaymentReceipt(buffer, mimeType, refId) {
  if (!buffer?.length) {
    throw new Error('Payment receipt upload failed: file is empty');
  }

  const actualType = resolveMimeType(buffer, mimeType);
  const ext = extensionForMime(actualType);
  const storagePath = `payment-receipts/${refId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: actualType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Payment receipt upload failed: ${error.message}`);
  }

  return storagePath;
}

/**
 * Deletes a screenshot from storage (used if expense is hard-deleted).
 */
export async function deleteScreenshot(storagePath) {
  if (!storagePath) return;

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.error('Failed to delete screenshot:', error.message);
  }
}
