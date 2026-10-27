const { Pool } = require('pg');

function databasePoolConfig(connectionString = process.env.DATABASE_URL, env = process.env) {
	if (!connectionString) throw new Error('Thiếu DATABASE_URL.');

	const sslMode = String(env.DB_SSL || 'auto').toLocaleLowerCase('en-US');
	const config = {
		connectionString,
		max: 5,
		connectionTimeoutMillis: 10000,
		idleTimeoutMillis: 30000
	};

	if (sslMode === 'true') config.ssl = { rejectUnauthorized: true };
	else if (sslMode === 'false') config.ssl = false;
	else if (sslMode !== 'auto') throw new Error('DB_SSL phải là auto, true hoặc false.');

	return config;
}

function createDatabasePool(connectionString, env) {
	return new Pool(databasePoolConfig(connectionString, env));
}

module.exports = { createDatabasePool, databasePoolConfig };
