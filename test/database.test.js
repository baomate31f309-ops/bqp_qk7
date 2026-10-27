const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databasePoolConfig } = require('../database');

test('uses SSL settings from the PostgreSQL URL by default', () => {
	const config = databasePoolConfig(
		'postgresql://user:password@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require',
		{ DB_SSL: 'auto' }
	);

	assert.equal(Object.hasOwn(config, 'ssl'), false);
	assert.equal(config.max, 5);
	assert.equal(config.connectionTimeoutMillis, 10000);
	const client = new Client(config);
	assert.ok(client.connectionParameters.ssl);
});

test('can require verified SSL explicitly', () => {
	const config = databasePoolConfig('postgresql://localhost/app', { DB_SSL: 'true' });

	assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('can disable SSL for local PostgreSQL', () => {
	const config = databasePoolConfig('postgresql://localhost/app', { DB_SSL: 'false' });

	assert.equal(config.ssl, false);
});

test('rejects invalid SSL modes and missing connection strings', () => {
	assert.throws(() => databasePoolConfig('postgresql://localhost/app', { DB_SSL: 'sometimes' }), /DB_SSL/);
	assert.throws(() => databasePoolConfig('', { DB_SSL: 'auto' }), /DATABASE_URL/);
});
