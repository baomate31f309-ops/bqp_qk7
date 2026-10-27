require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDatabasePool } = require('./database');

async function main() {
	const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
	if (!connectionString) throw new Error('Cần khai báo MIGRATION_DATABASE_URL hoặc DATABASE_URL trong .env');
	const pool = createDatabasePool(connectionString);
	try {
		await pool.query(await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8'));
		await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`);
		for (const migrationId of ['20261026_file_submissions', '20261026_military_subtypes', '20261026_member_catalogs']) {
			const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migrationId]);
			if (!applied.rowCount) {
				const migration = await fs.readFile(path.join(__dirname, 'migrations', `${migrationId}.sql`), 'utf8');
				const client = await pool.connect();
				try {
					await client.query('BEGIN');
					await client.query(migration);
					await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migrationId]);
					await client.query('COMMIT');
				} catch (error) {
					await client.query('ROLLBACK');
					throw error;
				} finally {
					client.release();
				}
			}
		}
		console.log('Đã tạo schema QT trong PostgreSQL.');
	} finally {
		await pool.end();
	}
}

main().catch(error => {
	console.error(`Không tạo được schema: ${error.message}`);
	process.exitCode = 1;
});
