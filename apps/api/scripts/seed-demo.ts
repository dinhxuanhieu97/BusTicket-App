/**
 * Demo data for testing before launch (see src/demo/demo-seed.ts for what is created and how it is marked).
 *
 *   DATABASE_URL=... pnpm --filter api seed:demo                 # operator PN, 7 days from today
 *   DATABASE_URL=... pnpm --filter api seed:demo -- --days=14 --operator=PN
 *   DATABASE_URL=... pnpm --filter api seed:demo -- --remove     # delete the demo data again
 *
 * A database that is not on this machine also needs `--yes`, so a wrong DATABASE_URL does not write by accident.
 * Customers are never notified: notifyCustomer is false and the seed marks its outbox events processed.
 * Waiting-for-transfer holds expire after the operator's hold time (+ grace) like real ones.
 */
import 'reflect-metadata';
import { SystemClock } from '../src/common/clock';
import { Db, DbConfig } from '../src/db/db';
import { DemoSeeder } from '../src/demo/demo-seed';
import { TokenSecret } from '../src/bookings/token-secret';

/** `--name=value`, `--name value` or a bare `--name` flag (''); undefined when absent. An empty `--name=` is rejected. */
function arg(name: string): string | undefined {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith(`--${name}=`)) {
      const v = a.slice(name.length + 3);
      if (!v) throw new Error(`--${name}= needs a value`);
      return v;
    }
    if (a === `--${name}`) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : '';
    }
  }
  return undefined;
}

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Local only when every way pg could pick a host points at this machine (loopback or a Unix socket). */
function isLocal(url: string): boolean {
  try {
    const u = new URL(url);
    const local = (h: string) => LOOPBACK.includes(h) || h.startsWith('/');
    const param = u.searchParams.get('host');
    if (param !== null) return local(param) && (u.hostname === '' || local(u.hostname));
    if (u.hostname !== '') return local(u.hostname);
    const env = process.env.PGHOST;
    return env === undefined || env === '' || local(env);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  const operator = arg('operator');
  const daysArg = arg('days');
  if (operator === '' || daysArg === '') throw new Error('--operator and --days need a value');
  const operatorCode = (operator ?? 'PN').toUpperCase();
  const days = Number(daysArg ?? 7);
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
