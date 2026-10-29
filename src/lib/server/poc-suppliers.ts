import { env } from '$env/dynamic/private';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SupplierReport } from '$lib/poc/suppliers';

const file = () => resolve(env.POC_SUPPLIER_FILE || './data/poc-suppliers.json');

export async function readSupplierReport(): Promise<SupplierReport | null> {
  try {
    const parsed = JSON.parse(await readFile(file(), 'utf8'));
    return parsed?.schemaVersion === 2 ? (parsed as SupplierReport) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
