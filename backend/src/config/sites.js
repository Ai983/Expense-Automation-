// Single source of truth for project/site names — read from the canonical
// public.projects table on the Hub (unified 2026-06-17). Replaces the old
// hardcoded SITES array so a project added in the Hub admin panel shows up
// everywhere without a code change. Cached for 60s to avoid per-request DB hits.
import { supabaseAdmin } from './supabase.js';

const TTL_MS = 60_000;
let cache = { at: 0, names: [], validSet: new Set() };

async function refresh() {
  // .schema('public') overrides the client's default 'finance' schema for this query
  const [projsRes, aliasRes] = await Promise.all([
    supabaseAdmin.schema('public').from('projects')
      .select('name').eq('is_active', true).eq('is_finance', true),
    supabaseAdmin.schema('public').from('project_aliases').select('alias'),
  ]);
  if (projsRes.error) throw projsRes.error;
  if (aliasRes.error) throw aliasRes.error;

  const names = (projsRes.data ?? []).map((r) => r.name).sort((a, b) => a.localeCompare(b));
  const validSet = new Set([
    ...names,
    ...(aliasRes.data ?? []).map((r) => r.alias),
  ].map((s) => String(s).trim().toLowerCase()));

  cache = { at: Date.now(), names, validSet };
}

async function ensureFresh() {
  if (Date.now() - cache.at < TTL_MS && cache.names.length) return;
  await refresh();
}

/** Canonical active finance site names, for dropdowns. */
export async function getProjectSites() {
  await ensureFresh();
  return cache.names;
}

/** True if `site` matches a canonical name or any known alias (case-insensitive). */
export async function isValidSite(site) {
  if (!site) return false;
  await ensureFresh();
  return cache.validSet.has(String(site).trim().toLowerCase());
}
