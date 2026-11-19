/**
 * Demo data for testing before launch (see src/demo/demo-seed.ts for what is created and how it is marked).
 *
 *   DATABASE_URL=... pnpm --filter api seed:demo                 # operator PN, 7 days from today
 *   DATABASE_URL=... pnpm --filter api seed:demo -- --days=14 --operator=PN
 *   DATABASE_URL=... pnpm --filter api seed:demo -- --remove     # delete the demo data again
 *
 * A database that is not on this machine also needs `--yes`, so a wrong DATABASE_URL does not write by accident.
 * Customers are never notified; demo phones are 0999xxxxxx.
 */
import 'reflect-metadata';
import { SystemClock } from '../src/common/clock';
import { Db, DbConfig } from '../src/db/db';
import { DemoSeeder } from '../src/demo/demo-seed';
import { TokenSecret } from '../src/bookings/token-secret';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    const q = new URL(url).searchParams.get('host') ?? '';
    return ['', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || q.startsWith('/');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  const operatorCode = (arg('operator') || 'PN').toUpperCase();
  const days = Number(arg('days') || 7);
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error('--days must be 1–31');
  if (!isLocal(url) && arg('yes') === undefined) {
    throw new Error(`DATABASE_URL is not a local database. Re-run with --yes to write demo data for ${operatorCode} there.`);
  }
  const db = new Db(new DbConfig(url));
  try {
    const secret = process.env.BOOKING_TOKEN_SECRET;
    const demo = new DemoSeeder(db, new SystemClock(), secret && secret.length >= 32 ? new TokenSecret(secret) : undefined);
    if (arg('remove') !== undefined) {
      console.log('Removed demo data:', await demo.remove(operatorCode));
      return;
    }
    const summary = await demo.seed({ operatorCode, days, log: (l) => console.log(l) });
    console.log('Demo data ready:', summary);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
