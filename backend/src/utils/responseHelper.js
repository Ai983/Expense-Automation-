/** Send a success response */
export function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

/** Send an error response */
export function fail(res, message, statusCode = 400) {
  return res.status(statusCode).json({ success: false, error: message });
}
