import { supabaseAdmin } from '../config/supabase.js';
import { STORAGE_BUCKET, SIGNED_URL_EXPIRY_SECONDS } from '../config/constants.js';

/**
 * Uploads an image buffer to Supabase Storage.
 * Returns the storage path (not a public URL — use getSignedUrl to access).
 */
export async function uploadScreenshot(buffer, mimeType, employeeId, refId) {
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const storagePath = `${employeeId}/${refId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Screenshot upload failed: ${error.message}`);
  }

  return storagePath;
}

/**
 * Generates a time-limited signed URL for viewing a private screenshot.
 */
export async function getSignedUrl(storagePath) {
  if (!storagePath) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    console.error('Failed to generate signed URL:', error.message);
    return null;
  }

  return data.signedUrl;
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
