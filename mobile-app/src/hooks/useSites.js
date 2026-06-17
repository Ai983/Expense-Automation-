import { useState, useEffect } from 'react';
import { getProjectSites } from '../services/projectService';
import { SITES as FALLBACK_SITES } from '../constants';

// Returns the canonical site list (live from /api/projects), falling back to the
// bundled SITES constant if the API is unreachable — so a project added in the
// Hub admin panel shows up in the app without a release, but pickers are never
// empty (offline / pre-login register screen / cold backend).
export function useSites() {
  const [sites, setSites] = useState(FALLBACK_SITES);
  useEffect(() => {
    let alive = true;
    getProjectSites()
      .then((names) => { if (alive && names.length) setSites(names); })
      .catch(() => { /* keep bundled fallback */ });
    return () => { alive = false; };
  }, []);
  return sites;
}