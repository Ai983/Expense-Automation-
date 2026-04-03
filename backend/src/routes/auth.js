import { Router } from 'express';
import { supabaseAdmin, supabaseAnon } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { ok, fail } from '../utils/responseHelper.js';
import { SITES, ROLES } from '../config/constants.js';

const router = Router();

// POST /api/auth/register
// Creates a Supabase Auth user + employee profile row
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name, phone, site, role } = req.body;

    // Validation
    if (!email || !password || !name || !site) {
      return fail(res, 'email, password, name, and site are required');
    }
    if (!SITES.includes(site)) {
      return fail(res, `Invalid site. Must be one of: ${SITES.join(', ')}`);
    }
    if (role && !ROLES.includes(role)) {
      return fail(res, `Invalid role. Must be one of: ${ROLES.join(', ')}`);
    }
    if (password.length < 6) {
      return fail(res, 'Password must be at least 6 characters');
    }

    // Create Supabase Auth user (admin call, skips email confirmation in dev)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        return fail(res, 'An account with this email already exists', 409);
      }
      throw authError;
    }

    const authUserId = authData.user.id;

    // Create employee profile row
    const { data: employee, error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        auth_id: authUserId,
        email,
        name,
        phone: phone || null,
        site,
        role: role || 'employee',
        status: 'active',
      })
      .select()
      .single();

    if (empError) {
      // Rollback auth user if profile insert fails
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw empError;
    }

    await logAudit({
      userId: employee.id,
      action: 'register',
      entityType: 'employee',
      entityId: employee.id,
      newValue: { email, name, site, role: employee.role },
      ipAddress: req.ip,
    });

    return ok(res, {
      message: 'Registration successful',
      employee: { id: employee.id, email, name, site, role: employee.role },
    }, 201);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
// Signs in via Supabase Auth and returns the session token
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return fail(res, 'email and password are required');
    }

    const { data: session, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return fail(res, 'Invalid email or password', 401);
    }

    // Fetch employee profile for role info
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('id, name, email, role, site, status')
      .eq('auth_id', session.user.id)
      .single();

    if (!employee) {
      return fail(
        res,
        'Employee profile not found. If you signed up via Create Account, run the SQL in database/005_fix_missing_employee.sql in Supabase SQL Editor to link your account.',
        404
      );
    }

    if (employee.status !== 'active') {
      return fail(res, 'Account suspended or inactive. Contact admin.', 403);
    }

    await logAudit({
      userId: employee.id,
      action: 'login',
      entityType: 'employee',
      entityId: employee.id,
      ipAddress: req.ip,
    });

    return ok(res, {
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
      expiresAt: session.session.expires_at,
      employee: { id: employee.id, name: employee.name, email: employee.email, role: employee.role, site: employee.site },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    await logAudit({
      userId: req.user.id,
      action: 'logout',
      entityType: 'employee',
      entityId: req.user.id,
      ipAddress: req.ip,
    });
    return ok(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — returns current user profile
router.get('/me', authMiddleware, async (req, res) => {
  return ok(res, {
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    site: req.user.site,
  });
});

export default router;
