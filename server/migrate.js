// server/migrate.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGR_DIR = path.resolve(__dirname, '..', 'migrations');

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getApplied(pool) {
  const { rows } = await pool.query(`SELECT name FROM _migrations ORDER BY id;`);
  return new Set(rows.map(r => r.name));
}

async function run() {
  const pool = getPool();
  if (!pool) {
    console.error('No DB config. Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE.');
    process.exit(1);
  }

  await ensureMigrationsTable(pool);
  const applied = await getApplied(pool);

  const files = fs.existsSync(MIGR_DIR)
    ? fs.readdirSync(MIGR_DIR).filter(f => /^\d+_.+\.sql$/i.test(f)).sort()
    : [];

  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`skip  ${f}`);
      continue;
    }
    const full = path.join(MIGR_DIR, f);
    const sql = fs.readFileSync(full, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1);', [f]);
      await client.query('COMMIT');
      console.log(`apply ${f}`);
      ran++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`fail  ${f}:`, e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  if (ran === 0) console.log('No new migrations.');
  await pool.end();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
