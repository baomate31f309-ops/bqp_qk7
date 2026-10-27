require('dotenv').config();

const { createDatabasePool } = require('./database');

async function main() {
	const pool = createDatabasePool();
	try {
		const result = await pool.query(
			`SELECT current_database() AS database,
			        current_setting('server_version') AS version,
			        (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`
		);
		const connection = result.rows[0];
		console.log(`Kết nối PostgreSQL thành công: ${connection.database} (PostgreSQL ${connection.version}; SSL ${connection.ssl ? 'bật' : 'tắt'}).`);
	} finally {
		await pool.end();
	}
}

main().catch(error => {
	console.error(`Không kết nối được PostgreSQL: ${error.message}`);
	process.exitCode = 1;
});
