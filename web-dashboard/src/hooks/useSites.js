import { useEffect, useState } from 'react';
import { getSites } from '../services/projectService';

// Shared hook: canonical site list from the unified master. Falls back to []
// (callers prepend their own 'all'/'Others' sentinels as needed).
export function useSites() {
  const [sites, setSites] = useState([]);
  useEffect(() => {
    let alive = true;
    getSites().then((s) => { if (alive) setSites(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return sites;
}
