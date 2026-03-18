import { supabaseAdmin } from '../config/supabase.js';

/**
 * Verifies the Supabase JWT Bearer token in Authorization header.
 * Attaches the full employee profile to req.user.
 */
export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Use Supabase to verify the JWT and get the auth user
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch employee profile to get app role and details
    const { data: employee, error: empError } = await supabaseAdmin
      .from('employees')
      .select('id, name, email, role, site, status')
      .eq('auth_id', user.id)
      .single();

    if (empError || !employee) {
      return res.status(401).json({ error: 'Employee profile not found. Please complete registration.' });
    }

    if (employee.status !== 'active') {
      return res.status(403).json({ error: 'Account is suspended or inactive. Contact admin.' });
    }

    req.user = {
      authId: user.id,
      ...employee,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
