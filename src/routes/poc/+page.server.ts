import type { PageServerLoad } from './$types';
import { readPocReport } from '$lib/server/poc-report';

export const load: PageServerLoad = async () => ({ report: await readPocReport() });
