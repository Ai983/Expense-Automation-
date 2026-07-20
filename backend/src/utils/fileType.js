/**
 * Detects a file's real type from its magic bytes.
 *
 * The client-supplied MIME type cannot be trusted: the mobile document picker
 * reports whatever the OS/SAF provider claims, so a JPEG chosen through the
 * "attach PDF" flow arrived labelled `application/pdf`. That label was baked
 * into the storage object name, its Content-Type header, `attachmentType`, and
 * the OCR content block — producing files the browser refused to render.
 *
 * Sniffing the buffer makes the bytes the source of truth for all of the above.
 */

const PDF_SEARCH_WINDOW = 1024;

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Returns the detected MIME type, or null when the bytes match no known
 * signature. Only the types this app accepts are detected.
 */
export function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  // JPEG — SOI marker
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP — "RIFF" .... "WEBP"
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }

  // PDF — "%PDF-". Normally at offset 0, but readers tolerate leading junk,
  // so scan a small window to avoid rejecting otherwise-valid documents.
  const pdfHeader = buffer.subarray(0, PDF_SEARCH_WINDOW).indexOf('%PDF-', 0, 'latin1');
  if (pdfHeader !== -1) return 'application/pdf';

  return null;
}

/**
 * Resolves the type to trust for a buffer.
 *
 * Detected bytes win. When nothing matches (an accepted-but-unrecognised
 * format, e.g. HEIC that the picker labelled image/jpeg) we fall back to the
 * declared type, which preserves the previous behaviour rather than rejecting.
 */
export function resolveMimeType(buffer, declaredType) {
  return sniffMimeType(buffer) || declaredType;
}

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Maps a MIME type to a storage file extension. Falls back to the subtype with
 * anything non-alphanumeric stripped, so unexpected types (`image/svg+xml`)
 * still yield a usable path instead of `svg+xml`.
 */
export function extensionForMime(mimeType) {
  if (EXTENSIONS[mimeType]) return EXTENSIONS[mimeType];
  const subtype = String(mimeType || '').split('/')[1] || 'bin';
  return subtype.split(/[+;]/)[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
}
