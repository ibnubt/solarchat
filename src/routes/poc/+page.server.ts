import type { PageServerLoad } from './$types';
import { summarise } from '$lib/poc/results';
import { readSupplierReport } from '$lib/server/poc-suppliers';

export const load: PageServerLoad = async () => {
  const report = await readSupplierReport();
  if (!report) return { report: null, summary: null };
  return { report, summary: summarise(report) };
};
