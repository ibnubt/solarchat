import { env } from '$env/dynamic/private';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PocReport } from '$lib/poc/types';

const reportFile = () => resolve(env.POC_REPORT_FILE || './data/poc-report.json');

export async function readPocReport(): Promise<PocReport | null> {
  try {
    return JSON.parse(await readFile(reportFile(), 'utf8')) as PocReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
