require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const users = [
	{ username: 'quanly1', password: '123456', name: 'Quản lý tài khoản', isAdmin: true },
	{ username: 'tulenh@qt.vn', password: '123456', name: 'Phạm Quang Minh', level: 5 },
	{ username: ' ', password: '123456', name: 'Lê Thu Hà', level: 4 },
	{ username: 'trungdoan@qt.vn', password: '123456', name: 'Nguyễn Hoàng Nam', level: 3 },
	{ username: 'tieudoantruong', password: '123456', name: 'Trần Quốc Bảo', level: 2 },
	{ username: 'linh@qt.vn', password: '123456', name: 'Nguyễn Minh Linh', level: 1 }
];
const positionTitles = new Map([
	[1, 'Đại đội trưởng'],
	[2, 'Tiểu đoàn trưởng'],
	[3, 'Trung đoàn trưởng'],
	[4, 'Sư đoàn trưởng'],
	[5, 'Tư lệnh']
]);

async function main() {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL chưa được cấu hình trong .env');
	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const ids = new Map();
		for (const user of users) {
			const result = await client.query(
				`INSERT INTO users (username, name, password_hash, military_rank, position_title, level, is_admin)
				 VALUES ($1, $2, $3, '', $4, $5, $6)
				 ON CONFLICT (username) DO UPDATE SET
				   name = EXCLUDED.name, position_title = EXCLUDED.position_title,
				   level = EXCLUDED.level, is_admin = EXCLUDED.is_admin
				 RETURNING id`,
				[user.username, user.name, await bcrypt.hash(user.password, 12),
					positionTitles.get(user.level) || '', user.level || null, Boolean(user.isAdmin)]
			);
			ids.set(user.username, result.rows[0].id);
		}
		for (const [username, managerUsername] of [
			['suddoan@qt.vn', 'tulenh@qt.vn'],
			['trungdoan@qt.vn', 'suddoan@qt.vn'],
			['tieudoantruong', 'trungdoan@qt.vn'],
			['linh@qt.vn', 'tieudoantruong']
		]) {
			await client.query('UPDATE users SET manager_id = $1 WHERE id = $2', [ids.get(managerUsername), ids.get(username)]);
		}
		await client.query('COMMIT');
		console.log('Đã tạo/cập nhật tài khoản demo. Mật khẩu demo đều là 123456; hãy đổi trước khi triển khai thật.');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
