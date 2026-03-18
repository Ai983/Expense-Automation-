/**
 * Middleware factory that restricts route access to specified roles.
 * Usage: router.post('/approve', authMiddleware, roleGuard(['finance', 'admin']), handler)
 */
export function roleGuard(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. This action requires one of: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}
