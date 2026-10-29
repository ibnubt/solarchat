import type { PageServerLoad } from './$types';
import { analyse } from '$lib/poc/suppliers';
import { readSupplierReport } from '$lib/server/poc-suppliers';

export const load: PageServerLoad = async () => {
  const report = await readSupplierReport();
  if (!report) return { report: null, analysis: null };
  // Sampel mentah dikirim terpisah agar lampiran tetap bisa ditelusuri dan diunduh.
  return { report, analysis: analyse(report) };
};
