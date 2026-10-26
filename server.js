require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_SECRET = process.env.SESSION_SECRET;
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false
});
const app = express();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 15 * 1024 * 1024, files: 5 }
});
const roles = new Map([
	[1, 'Đại đội trưởng'],
	[2, 'Tiểu đoàn trưởng'],
	[3, 'Trung đoàn trưởng'],
	[4, 'Sư đoàn trưởng'],
	[5, 'Tư lệnh']
]);
const subtypes = {
	'Quân sự': ['Pháo', 'Công', 'Bộ', 'TT', 'Phòng không'],
	'Chính trị': [],
	'Hậu cần kỹ thuật': ['Quân nhu', 'Doanh trại', 'Quân y']
};
const wordFileTypes = new Map([
	['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	['.doc', 'application/msword']
]);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
	if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
		const origin = req.get('origin');
		if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
			return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
		}
	}
	next();
});
app.use(session({
	store: new PgSession({
		pool,
		tableName: 'qt_sessions',
		createTableIfMissing: false
	}),
	name: 'qt.sid',
	secret: SESSION_SECRET || 'development-only-change-this-secret-before-deploying',
	resave: false,
	saveUninitialized: false,
	cookie: {
		httpOnly: true,
		sameSite: 'strict',
		secure: process.env.NODE_ENV === 'production',
		maxAge: 8 * 60 * 60 * 1000
	}
}));

function asyncRoute(handler) {
	return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function publicUser(row) {
	return {
		id: row.id,
		username: row.username,
		name: row.name,
		level: row.level,
		role: row.is_admin ? 'Quản lý tài khoản' : roles.get(Number(row.level)),
		isAdmin: row.is_admin
	};
}

function requireAuth(req, res, next) {
	if (!req.session.userId) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
	pool.query(
		'SELECT id, username, name, level, is_admin FROM users WHERE id = $1',
		[req.session.userId]
	).then(result => {
		if (!result.rowCount) {
			req.session.destroy(() => {});
			return res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' });
		}
		req.user = publicUser(result.rows[0]);
		return next();
	}).catch(next);
}

function requireBusinessUser(req, res, next) {
	if (req.user.isAdmin) return res.status(403).json({ error: 'Tài khoản quản lý không tham gia luồng gửi và phê duyệt giáo án.' });
	next();
}

function requireAdmin(req, res, next) {
	if (!req.user.isAdmin) return res.status(403).json({ error: 'Chỉ tài khoản quản lý mới được thực hiện thao tác này.' });
	next();
}

function normalizeFileName(fileName) {
	if ([...fileName].some(character => character.charCodeAt(0) > 0xff)) return fileName;
	const bytes = Buffer.from(fileName, 'latin1');
	const decoded = bytes.toString('utf8');
	if (decoded.includes('\uFFFD') || !Buffer.from(decoded, 'utf8').equals(bytes)) return fileName;
	return decoded;
}

function uploadedFileName(file) {
	return normalizeFileName(file.originalname);
}

function submissionContentType(file) {
	const extension = path.extname(uploadedFileName(file)).toLocaleLowerCase('en-US');
	if (extension === '.pdf') return 'application/pdf';
	return wordFileTypes.get(extension) || 'application/octet-stream';
}

function validCourse(courseType, courseSubtype) {
	return Object.hasOwn(subtypes, courseType)
		&& (subtypes[courseType].length === 0 ? !courseSubtype : subtypes[courseType].includes(courseSubtype || ''));
}

function validateSubmissionFiles(files) {
	if (!files.length) return 'Cần tải lên ít nhất một tệp Word (.doc/.docx) hoặc PDF.';
	for (const file of files) {
		const fileName = uploadedFileName(file);
		const extension = path.extname(fileName).toLocaleLowerCase('en-US');
		const validPdf = extension === '.pdf' && file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'));
		const validDocx = extension === '.docx' && file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
		const validDoc = extension === '.doc' && file.buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
		if (!validPdf && !validDocx && !validDoc) {
			return `Tệp "${path.basename(fileName)}" không đúng định dạng Word hoặc PDF.`;
		}
	}
	return '';
}

async function canAccessDocument(documentId, userId) {
	const result = await pool.query(
		'SELECT id, sender_id, recipient_id FROM documents WHERE id = $1',
		[documentId]
	);
	const doc = result.rows[0];
	if (!doc || (doc.sender_id !== userId && doc.recipient_id !== userId)) return null;
	return doc;
}

const loginLimiter = rateLimit({
	windowMs: 5 * 60 * 1000,
	limit: 10,
	skipSuccessfulRequests: true,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.' }
});

app.get('/api/health', asyncRoute(async (_req, res) => {
	await pool.query('SELECT 1');
	res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res, next) => {
	const username = String(req.body?.username || '').trim().toLocaleLowerCase('vi');
	const password = String(req.body?.password || '');
	const result = await pool.query(
		'SELECT id, username, name, password_hash, level, is_admin FROM users WHERE LOWER(username) = $1',
		[username]
	);
	const user = result.rows[0];
	if (!user || !(await bcrypt.compare(password, user.password_hash))) {
		return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu chưa chính xác.' });
	}
	req.session.regenerate(error => {
		if (error) return next(error);
		req.session.userId = user.id;
		req.session.save(saveError => {
			if (saveError) return next(saveError);
			return res.json({ user: publicUser(user) });
		});
	});
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.get('/api/word-templates', requireAuth, requireBusinessUser, asyncRoute(async (_req, res) => {
	const result = await pool.query(
		`SELECT id, file_name AS "fileName", course_type AS "courseType",
		        course_subtype AS "courseSubtype", size_bytes AS "sizeBytes"
		 FROM word_templates
		 ORDER BY course_type, course_subtype, file_name`
	);
	res.json({ templates: result.rows.map(template => ({
		...template,
		fileName: normalizeFileName(template.fileName)
	})) });
}));

app.get('/api/word-templates/:id/download', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		'SELECT file_name, content_type, data FROM word_templates WHERE id = $1',
		[req.params.id]
	);
	const file = result.rows[0];
	if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp Word mẫu.' });
	res.setHeader('Content-Type', file.content_type);
	res.setHeader('Content-Length', file.data.length);
	res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(normalizeFileName(file.file_name))}`);
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Cache-Control', 'private, no-store');
	res.send(file.data);
}));

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
	req.session.destroy(error => {
		if (error) return next(error);
		res.clearCookie('qt.sid', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
		res.status(204).end();
	});
});

app.get('/api/recipients', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`SELECT id, username, name, level, is_admin FROM users
		 WHERE is_admin = FALSE AND id <> $1 AND level IN ($2, $3)
		 ORDER BY level DESC, name`,
		[req.user.id, req.user.level, req.user.level + 1]
	);
	res.json({ recipients: result.rows.map(publicUser) });
}));

app.get('/api/documents', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`SELECT d.id, d.title, d.course_type AS "courseType",
		        d.course_subtype AS "courseSubtype", d.status, d.sent_at AS "sentAt",
		        sender.id AS "senderId", sender.name AS sender, sender.level AS "senderLevel",
		        recipient.id AS "recipientId", recipient.name AS recipient, recipient.level AS "recipientLevel",
		        COALESCE((SELECT json_agg(json_build_object(
		            'id', n.id, 'author', author.name, 'text', n.text, 'at', n.created_at
		        ) ORDER BY n.created_at) FROM document_notes n
		            JOIN users author ON author.id = n.author_id WHERE n.document_id = d.id), '[]'::json) AS notes,
		        COALESCE((SELECT json_agg(json_build_object(
		            'id', a.id, 'name', a.name, 'type', a.content_type, 'size', a.size_bytes
		        ) ORDER BY a.created_at) FROM attachments a WHERE a.document_id = d.id), '[]'::json) AS attachments
		 FROM documents d
		 JOIN users sender ON sender.id = d.sender_id
		 JOIN users recipient ON recipient.id = d.recipient_id
		 WHERE d.sender_id = $1 OR d.recipient_id = $1
		 ORDER BY d.sent_at DESC`,
		[req.user.id]
	);
	res.json({ documents: result.rows.map(row => ({
		...row,
		attachments: row.attachments.map(file => ({ ...file, name: normalizeFileName(file.name) })),
		senderRole: roles.get(Number(row.senderLevel)),
		recipientRole: roles.get(Number(row.recipientLevel))
	})) });
}));

app.post('/api/documents', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const { draftId, title, courseType, courseSubtype = '', recipientId } = req.body || {};
	if (!String(title || '').trim()) return res.status(400).json({ error: 'Tên giáo án là bắt buộc.' });
	if (!validCourse(courseType, courseSubtype)) {
		return res.status(400).json({ error: 'Loại giáo án hoặc nội dung chưa hợp lệ.' });
	}
	const recipientResult = await pool.query(
		'SELECT id, name, level, is_admin FROM users WHERE id = $1',
		[recipientId]
	);
	const recipient = recipientResult.rows[0];
	if (!recipient || recipient.is_admin || ![req.user.level, req.user.level + 1].includes(Number(recipient.level))) {
		return res.status(403).json({ error: 'Chỉ được gửi cho người cùng cấp hoặc cấp trên một cấp.' });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const draft = await client.query(
			'SELECT id FROM drafts WHERE id = $1 AND owner_id = $2 FOR UPDATE',
			[draftId, req.user.id]
		);
		if (!draft.rowCount) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Không tìm thấy bản nháp của tài khoản này.' });
		}
		const attached = await client.query('SELECT EXISTS (SELECT 1 FROM attachments WHERE draft_id = $1) AS has_files', [draftId]);
		if (!attached.rows[0].has_files) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Tải lên ít nhất một tệp Word hoặc PDF trước khi gửi.' });
		}
		const created = await client.query(
			`INSERT INTO documents (sender_id, recipient_id, title, course_type, course_subtype)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[req.user.id, recipient.id, String(title).trim(), courseType, courseSubtype]
		);
		await client.query(
			'UPDATE attachments SET document_id = $1, draft_id = NULL WHERE draft_id = $2',
			[created.rows[0].id, draftId]
		);
		await client.query('DELETE FROM drafts WHERE id = $1', [draftId]);
		await client.query('COMMIT');
		res.status(201).json({ id: created.rows[0].id });
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}));

app.post('/api/documents/:id/notes', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const text = String(req.body?.text || '').trim();
	if (!text) return res.status(400).json({ error: 'Nội dung ghi chú không được để trống.' });
	const doc = await canAccessDocument(req.params.id, req.user.id);
	if (!doc) return res.status(404).json({ error: 'Không tìm thấy giáo án hoặc bạn không có quyền xem.' });
	const result = await pool.query(
		'INSERT INTO document_notes (document_id, author_id, text) VALUES ($1, $2, $3) RETURNING id, text, created_at',
		[doc.id, req.user.id, text]
	);
	res.status(201).json({ note: { ...result.rows[0], author: req.user.name, at: result.rows[0].created_at } });
}));

app.post('/api/documents/:id/approve', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`UPDATE documents SET status = 'Đã phê duyệt', approved_at = NOW(), approved_by = $1
		 WHERE id = $2 AND recipient_id = $1 AND status = 'Chờ phê duyệt'
		 RETURNING id, status, approved_at`,
		[req.user.id, req.params.id]
	);
	if (!result.rowCount) return res.status(403).json({ error: 'Chỉ người nhận mới có thể phê duyệt giáo án đang chờ.' });
	res.json({ document: result.rows[0] });
}));

app.post('/api/documents/:id/reject', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	if (req.body?.reason !== undefined && typeof req.body.reason !== 'string') {
		return res.status(400).json({ error: 'Lý do từ chối không hợp lệ.' });
	}
	const reason = (req.body?.reason || '').trim();
	if (reason.length > 2000) return res.status(400).json({ error: 'Lý do từ chối không được vượt quá 2000 ký tự.' });

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query(
			`UPDATE documents SET status = 'Từ chối'
			 WHERE id = $1 AND recipient_id = $2 AND status = 'Chờ phê duyệt'
			 RETURNING id, status`,
			[req.params.id, req.user.id]
		);
		if (!result.rowCount) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Chỉ người nhận mới có thể từ chối giáo án đang chờ.' });
		}
		if (reason) {
			await client.query(
				'INSERT INTO document_notes (document_id, author_id, text) VALUES ($1, $2, $3)',
				[result.rows[0].id, req.user.id, `Lý do từ chối: ${reason}`]
			);
		}
		await client.query('COMMIT');
		res.json({ document: result.rows[0] });
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}));

app.get('/api/drafts', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`SELECT d.id, d.title, d.course_type AS "courseType",
		        d.course_subtype AS "courseSubtype", d.recipient_id AS "recipientId",
		        d.updated_at AS "updatedAt",
		        COALESCE((SELECT json_agg(json_build_object(
		            'id', a.id, 'name', a.name, 'type', a.content_type, 'size', a.size_bytes
		        ) ORDER BY a.created_at) FROM attachments a WHERE a.draft_id = d.id), '[]'::json) AS attachments
		 FROM drafts d WHERE d.owner_id = $1 ORDER BY d.updated_at DESC`,
		[req.user.id]
	);
	res.json({ drafts: result.rows.map(draft => ({
		...draft,
		attachments: draft.attachments.map(file => ({ ...file, name: normalizeFileName(file.name) }))
	})) });
}));

app.post('/api/drafts', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const { id, title, courseType, courseSubtype = '', recipientId = null } = req.body || {};
	if (!String(title || '').trim()) return res.status(400).json({ error: 'Tên giáo án là bắt buộc.' });
	if (!validCourse(courseType, courseSubtype)) return res.status(400).json({ error: 'Loại giáo án hoặc nội dung chưa hợp lệ.' });
	if (recipientId) {
		const recipient = await pool.query(
			'SELECT id, level, is_admin FROM users WHERE id = $1',
			[recipientId]
		);
		if (!recipient.rowCount || recipient.rows[0].is_admin ||
			![req.user.level, req.user.level + 1].includes(Number(recipient.rows[0].level))) {
			return res.status(403).json({ error: 'Người nhận phải cùng cấp hoặc cấp trên một cấp.' });
		}
	}
	const draftId = id || crypto.randomUUID();
	const result = await pool.query(
		`INSERT INTO drafts (id, owner_id, title, course_type, course_subtype, recipient_id)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (id) DO UPDATE SET
		   title = EXCLUDED.title,
		   course_type = EXCLUDED.course_type, course_subtype = EXCLUDED.course_subtype,
		   recipient_id = EXCLUDED.recipient_id, updated_at = NOW()
		 WHERE drafts.owner_id = EXCLUDED.owner_id
		 RETURNING id, title, course_type AS "courseType",
		           course_subtype AS "courseSubtype", recipient_id AS "recipientId",
		           updated_at AS "updatedAt"`,
		[draftId, req.user.id, String(title).trim(), courseType, courseSubtype, recipientId]
	);
	if (!result.rowCount) return res.status(404).json({ error: 'Không tìm thấy bản nháp để cập nhật.' });
	res.json({ draft: result.rows[0] });
}));

app.delete('/api/drafts/:id', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query('DELETE FROM drafts WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
	if (!result.rowCount) return res.status(404).json({ error: 'Không tìm thấy bản nháp của tài khoản này.' });
	res.status(204).end();
}));

app.post('/api/drafts/:id/attachments', requireAuth, requireBusinessUser, upload.array('files', 5), asyncRoute(async (req, res) => {
	const draft = await pool.query('SELECT id FROM drafts WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
	if (!draft.rowCount) return res.status(404).json({ error: 'Không tìm thấy bản nháp của tài khoản này.' });
	const files = req.files || [];
	const fileError = validateSubmissionFiles(files);
	if (fileError) return res.status(400).json({ error: fileError });
	const added = [];
	for (const file of files) {
		const result = await pool.query(
			`INSERT INTO attachments (draft_id, name, content_type, size_bytes, data)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id, name, content_type AS type, size_bytes AS size`,
			[draft.rows[0].id, path.basename(uploadedFileName(file)), submissionContentType(file), file.size, file.buffer]
		);
		added.push(result.rows[0]);
	}
	res.status(201).json({ attachments: added });
}));

app.delete('/api/drafts/:draftId/attachments/:attachmentId', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`DELETE FROM attachments a USING drafts d
		 WHERE a.id = $1 AND a.draft_id = d.id AND d.id = $2 AND d.owner_id = $3`,
		[req.params.attachmentId, req.params.draftId, req.user.id]
	);
	if (!result.rowCount) return res.status(404).json({ error: 'Không tìm thấy tệp trong bản nháp.' });
	res.status(204).end();
}));

app.post('/api/documents/:id/attachments', requireAuth, requireBusinessUser, upload.array('files', 5), asyncRoute(async (req, res) => {
	const doc = await canAccessDocument(req.params.id, req.user.id);
	if (!doc || doc.sender_id !== req.user.id) return res.status(404).json({ error: 'Không tìm thấy giáo án để thêm tệp.' });
	const files = req.files || [];
	const fileError = validateSubmissionFiles(files);
	if (fileError) return res.status(400).json({ error: fileError });
	const added = [];
	for (const file of files) {
		const result = await pool.query(
			`INSERT INTO attachments (document_id, name, content_type, size_bytes, data)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
			[doc.id, path.basename(uploadedFileName(file)), submissionContentType(file), file.size, file.buffer]
		);
		added.push(result.rows[0]);
	}
	res.status(201).json({ attachments: added });
}));

app.get('/api/attachments/:id', requireAuth, requireBusinessUser, asyncRoute(async (req, res) => {
	const result = await pool.query(
		`SELECT a.name, a.content_type, a.data,
		        d.owner_id, doc.sender_id, doc.recipient_id
		 FROM attachments a
		 LEFT JOIN drafts d ON d.id = a.draft_id
		 LEFT JOIN documents doc ON doc.id = a.document_id
		 WHERE a.id = $1`,
		[req.params.id]
	);
	const file = result.rows[0];
	if (!file || (file.owner_id !== req.user.id && file.sender_id !== req.user.id && file.recipient_id !== req.user.id)) {
		return res.status(404).json({ error: 'Không tìm thấy tệp hoặc bạn không có quyền tải.' });
	}
	res.setHeader('Content-Type', file.content_type);
	res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(normalizeFileName(file.name))}`);
	res.send(file.data);
}));

app.get('/api/management/users', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
	const result = await pool.query(
		`SELECT u.id, u.username, u.name, u.level, u.is_admin, m.name AS manager
		 FROM users u LEFT JOIN users m ON m.id = u.manager_id
		 ORDER BY u.is_admin DESC, u.level DESC NULLS LAST, u.name`
	);
	res.json({ users: result.rows.map(row => ({ ...publicUser(row), manager: row.manager || 'Bộ Quốc phòng' })) });
}));

app.get('/api/management/word-templates', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
	const result = await pool.query(
		`SELECT id, file_name AS "fileName", course_type AS "courseType",
		        course_subtype AS "courseSubtype", size_bytes AS "sizeBytes"
		 FROM word_templates
		 ORDER BY course_type, course_subtype, file_name`
	);
	res.json({ templates: result.rows.map(template => ({
		...template,
		fileName: normalizeFileName(template.fileName)
	})) });
}));

app.post('/api/management/word-templates', requireAuth, requireAdmin, upload.single('file'), asyncRoute(async (req, res) => {
	const { courseType, courseSubtype = '' } = req.body || {};
	const file = req.file;
	if (!file) return res.status(400).json({ error: 'Chọn tệp Word định dạng .doc hoặc .docx.' });
	if (!validCourse(courseType, courseSubtype)) {
		return res.status(400).json({ error: 'Loại giáo án hoặc nội dung mẫu chưa hợp lệ.' });
	}
	const fileName = uploadedFileName(file);
	const extension = path.extname(fileName).toLocaleLowerCase('en-US');
	const contentType = wordFileTypes.get(extension);
	const isDocx = extension === '.docx'
		&& file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
	const isDoc = extension === '.doc'
		&& file.buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
	if (!contentType || (!isDocx && !isDoc)) {
		return res.status(400).json({ error: 'Tệp không đúng định dạng Word .doc hoặc .docx.' });
	}
	const safeFileName = path.basename(fileName).replace(/[\u0000-\u001f\u007f]/g, '').trim();
	if (!safeFileName || safeFileName.length > 255) {
		return res.status(400).json({ error: 'Tên tệp Word không hợp lệ hoặc vượt quá 255 ký tự.' });
	}
	const result = await pool.query(
		`INSERT INTO word_templates (file_name, course_type, course_subtype, content_type, size_bytes, data, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, file_name AS "fileName", course_type AS "courseType",
		           course_subtype AS "courseSubtype", size_bytes AS "sizeBytes"`,
		[safeFileName, courseType, courseSubtype, contentType, file.size, file.buffer, req.user.id]
	);
	res.status(201).json({ template: result.rows[0] });
}));

app.delete('/api/management/word-templates/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
	const result = await pool.query('DELETE FROM word_templates WHERE id = $1', [req.params.id]);
	if (!result.rowCount) return res.status(404).json({ error: 'Không tìm thấy tệp Word mẫu.' });
	res.status(204).end();
}));

app.post('/api/management/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
	const { username, password, name, level, managerId } = req.body || {};
	const selectedLevel = Number(level);
	if (!String(username || '').trim() || !String(name || '').trim() || !Number.isInteger(selectedLevel) || !roles.has(selectedLevel)) {
		return res.status(400).json({ error: 'Tên tài khoản, họ tên và cấp bậc hợp lệ là bắt buộc.' });
	}
	if (!/^\d{6,}$/.test(String(password || ''))) {
		return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 chữ số và chỉ chứa chữ số.' });
	}
	if (selectedLevel < 5 && !managerId) return res.status(400).json({ error: 'Cần chọn chỉ huy trực tiếp.' });
	if (managerId) {
		const manager = await pool.query('SELECT level, is_admin FROM users WHERE id = $1', [managerId]);
		if (!manager.rowCount || manager.rows[0].is_admin || Number(manager.rows[0].level) !== selectedLevel + 1) {
			return res.status(400).json({ error: 'Chỉ huy trực tiếp phải cao hơn đúng một cấp.' });
		}
	}
	const result = await pool.query(
		`INSERT INTO users (username, name, password_hash, level, manager_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, username, name, level, is_admin`,
		[String(username).trim().toLocaleLowerCase('vi'), String(name).trim(), await bcrypt.hash(password, 12), selectedLevel, managerId || null]
	);
	res.status(201).json({ user: publicUser(result.rows[0]) });
}));

const staticFiles = new Set([
	'index.html', 'dashboard.html', 'quan-ly.html', 'mau-word.html', 'gui-giao-an.html',
	'app.js', 'navigation.html', 'style.css', 'Vietnam_Ministry_of_National_Defence_emblem.svg.webp'
]);
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/:file', asyncRoute(async (req, res, next) => {
	if (!staticFiles.has(req.params.file)) return next();
	res.sendFile(path.join(PUBLIC_DIR, req.params.file), { headers: { 'Cache-Control': 'no-store' } });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));
app.use((error, _req, res, _next) => {
	console.error(error);
	if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ.' });
	if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Nội dung yêu cầu vượt quá giới hạn.' });
	if (error instanceof multer.MulterError) {
		return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Mỗi tệp tối đa 15 MB.' : 'Số lượng hoặc kích thước tệp không hợp lệ.' });
	}
	if (error.code === '23505') return res.status(409).json({ error: 'Tên tài khoản đã tồn tại.' });
	if (error.code === '23503' || error.code === '22P02') return res.status(400).json({ error: 'Dữ liệu tham chiếu không hợp lệ.' });
	return res.status(500).json({ error: 'Máy chủ gặp lỗi. Hãy kiểm tra log backend.' });
});

async function start() {
	if (!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL. Hãy tạo file .env từ .env.example.');
	if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
		throw new Error('SESSION_SECRET cần có ít nhất 32 ký tự ngẫu nhiên.');
	}
	await pool.query('SELECT 1');
	const schema = await pool.query(
		"SELECT to_regclass('public.users') AS users, to_regclass('public.qt_sessions') AS sessions, to_regclass('public.word_templates') AS word_templates"
	);
	if (!schema.rows[0].users || !schema.rows[0].sessions || !schema.rows[0].word_templates) {
		throw new Error('Chưa có schema. Hãy chạy npm run db:setup bằng tài khoản migration trước.');
	}
	app.listen(PORT, HOST, () => console.log(`QT API sẵn sàng tại http://${HOST}:${PORT}`));
}

start().catch(error => {
	console.error(`Không thể khởi động backend: ${error.message}`);
	pool.end().finally(() => { process.exitCode = 1; });
});
