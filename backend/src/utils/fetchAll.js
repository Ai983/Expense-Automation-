/**
 * Fetch ALL rows from a Supabase query, transparently paginating past the
 * server's default 1000-row cap.
 *
 * Supabase/PostgREST returns at most `max-rows` (default 1000) per request.
 * Aggregation endpoints that pull every row (e.g. per-employee reports) would
 * silently truncate once the table grows beyond that. This helper keeps
 * issuing .range() windows until a short page signals the end.
 *
 * @param {(from: number, to: number) => any} buildQuery
 *        Factory that returns a fresh Supabase query for the given range.
 *        Example: (from, to) => supabaseAdmin.from('expenses').select('...').range(from, to)
 * @param {number} [pageSize=1000]
 * @returns {Promise<any[]>} every matching row
 */
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const all = [];
  let from = 0;
  // Hard ceiling to avoid an infinite loop on a misbehaving query (1M rows)
  for (let guard = 0; guard < 1000; guard++) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break; // last (short) page
    from += pageSize;
  }
  return all;
}
