// Single source of truth for project/site names — read from the canonical
// public.projects table on the Hub (unified 2026-06-17). Replaces the old
// hardcoded SITES array so a project added in the Hub admin panel shows up
// everywhere without a code change. Cached for 60s to avoid per-request DB hits.
import { supabaseAdmin } from './supabase.js';

const TTL_MS = 60_000;
let cache = { at: 0, names: [], validSet: new Set(), variants: new Map() };

const norm = (s) => String(s).trim().toLowerCase();

async function refresh() {
  // .schema('public') overrides the client's default 'finance' schema for this query
  const [projsRes, aliasRes] = await Promise.all([
    supabaseAdmin.schema('public').from('projects')
      .select('id, name').eq('is_active', true).eq('is_finance', true),
    supabaseAdmin.schema('public').from('project_aliases').select('alias, project_id'),
  ]);
  if (projsRes.error) throw projsRes.error;
  if (aliasRes.error) throw aliasRes.error;

  const projs = projsRes.data ?? [];
  const aliases = aliasRes.data ?? [];
  const names = projs.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  const validSet = new Set([...names, ...aliases.map((r) => r.alias)].map(norm));

  // Every spelling a project has been saved under (canonical name + pre-unification
  // aliases), keyed by each of those spellings — lets a lookup match old rows.
  const byProject = new Map(projs.map((p) => [p.id, [p.name]]));
  for (const a of aliases) byProject.get(a.project_id)?.push(a.alias);
  const variants = new Map();
  for (const group of byProject.values()) {
    for (const s of group) variants.set(norm(s), group);
  }

  cache = { at: Date.now(), names, validSet, variants };
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
  return cache.validSet.has(norm(site));
}

/** All stored spellings of the same project as `site` (itself included). */
export async function siteVariants(site) {
  if (!site) return [];
  await ensureFresh();
  return cache.variants.get(norm(site)) ?? [site];
}
