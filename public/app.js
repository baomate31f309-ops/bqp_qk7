const ROLES = new Map([
	[1, 'Đại đội trưởng'],
	[2, 'Tiểu đoàn trưởng'],
	[3, 'Trung đoàn trưởng'],
	[4, 'Sư đoàn trưởng'],
	[5, 'Tư lệnh']
]);
const SUBTYPES = {
	'Quân sự': ['Pháo', 'Công', 'Bộ', 'TT', 'Phòng không'],
	'Chính trị': [],
	'Hậu cần kỹ thuật': ['Quân nhu', 'Doanh trại', 'Quân y']
};
let currentUser;

async function api(url, options = {}) {
	const response = await fetch(url, {
		credentials: 'same-origin',
		...options,
		headers: {
			...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
			...options.headers
		}
	});
	if (response.status === 204) return null;
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(result.error || `Yêu cầu thất bại (${response.status}).`);
	return result;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character]);
}

function formatDate(value) {
	return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function activateIcons(root = document) {
	if (window.lucide) window.lucide.createIcons({ root });
}

async function loadNavigation(page) {
	const response = await fetch('/navigation.html', { credentials: 'same-origin' });
	if (!response.ok) throw new Error(`Không tải được navigation component (${response.status}).`);
	const template = document.createElement('template');
	template.innerHTML = await response.text();
	const sidebar = template.content.querySelector('[data-sidebar]');
	const topbar = template.content.querySelector('[data-topbar]');
	const sidebarPlaceholder = document.querySelector('[data-sidebar-placeholder]');
	const topbarPlaceholder = document.querySelector('[data-topbar-placeholder]');
	if (!sidebar || !topbar || !sidebarPlaceholder || !topbarPlaceholder) {
		throw new Error('Navigation component hoặc vị trí chèn component không hợp lệ.');
	}
	sidebar.querySelector(`[data-nav-page="${page}"]`)?.classList.add('active');
	const pageTitles = {
		dashboard: 'Dashboard',
		submission: 'Gửi giáo án',
		management: 'Quản lý tài khoản',
		'word-templates': 'Upload mẫu Word'
	};
	topbar.querySelector('[data-topbar-title]').textContent = pageTitles[page];
	sidebarPlaceholder.replaceWith(sidebar);
	topbarPlaceholder.replaceWith(topbar);
}

function showToast(message, type = 'error') {
	let container = document.getElementById('toast-region');
	if (!container) {
		container = document.createElement('div');
		container.id = 'toast-region';
		container.className = 'toast-region';
		container.setAttribute('aria-label', 'Thông báo');
		document.body.append(container);
	}
	const toast = document.createElement('div');
	toast.className = `toast toast-${type}`;
	toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
	const icon = document.createElement('span');
	icon.className = 'toast-icon';
	icon.setAttribute('aria-hidden', 'true');
	icon.textContent = type === 'error' ? '!' : '✓';
	const text = document.createElement('p');
	text.className = 'toast-text';
	text.textContent = message;
	const close = document.createElement('button');
	close.className = 'toast-close';
	close.type = 'button';
	close.setAttribute('aria-label', 'Đóng thông báo');
	close.textContent = '×';
	let timer;
	const dismiss = () => {
		window.clearTimeout(timer);
		toast.classList.add('toast-leaving');
		toast.addEventListener('animationend', () => toast.remove(), { once: true });
		window.setTimeout(() => toast.remove(), 250);
	};
	close.addEventListener('click', dismiss);
	toast.append(icon, text, close);
	container.append(toast);
	timer = window.setTimeout(dismiss, type === 'error' ? 6500 : 4000);
}

function showError(message, error) {
	console.error(error);
	showToast(`${message}: ${error.message}`);
}

function courseLabel(item) {
	return item.courseSubtype ? `${item.courseType} · ${item.courseSubtype}` : item.courseType || 'Giáo án';
}

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAttachment(file) {
	const response = await fetch(`/api/attachments/${encodeURIComponent(file.id)}`, { credentials: 'same-origin' });
	if (!response.ok) {
		const result = await response.json().catch(() => ({}));
		throw new Error(result.error || 'Không tải được tệp.');
	}
	downloadBlob(await response.blob(), file.name);
}

async function downloadWordTemplate(file) {
	const response = await fetch(`/api/word-templates/${encodeURIComponent(file.id)}/download`, { credentials: 'same-origin' });
	if (!response.ok) {
		const result = await response.json().catch(() => ({}));
		throw new Error(result.error || 'Không tải được tệp Word mẫu.');
	}
	downloadBlob(await response.blob(), file.fileName);
}

async function setupDashboard() {
	const tbody = document.getElementById('documents-body');
	const search = document.getElementById('document-search');
	const filter = document.getElementById('status-filter');
	const previewDialog = document.getElementById('preview-dialog');
	const notesDialog = document.getElementById('notes-dialog');
	const approveDialog = document.getElementById('approve-dialog');
	const rejectDialog = document.getElementById('reject-dialog');
	const filesDialog = document.getElementById('files-dialog');
	let documents = [];
	let activeId = null;

	function render() {
		const query = search.value.trim().toLocaleLowerCase('vi');
		const filtered = documents.filter(item => {
			const files = (item.attachments || []).map(file => file.name).join(' ');
			return `${item.title} ${item.sender} ${item.recipient} ${files}`.toLocaleLowerCase('vi').includes(query)
				&& (!filter.value || item.status === filter.value);
		});
		tbody.replaceChildren();
		filtered.forEach(item => {
			const row = document.createElement('tr');
			const statusClass = item.status === 'Đã phê duyệt' ? 'approved' : item.status === 'Từ chối' ? 'rejected' : 'pending';
			const attachments = item.attachments || [];
			row.innerHTML = `<td><div class="doc-name">${escapeHtml(item.title)}</div><div class="doc-sub">${escapeHtml(courseLabel(item))} · ${item.notes.length} ghi chú</div></td>
				<td>${escapeHtml(item.sender)}<div class="doc-sub">${escapeHtml(item.senderRole)}</div></td>
				<td>${escapeHtml(item.recipient)}<div class="doc-sub">${escapeHtml(item.recipientRole)}</div></td>
				<td>${escapeHtml(formatDate(item.sentAt))}</td>
				<td class="file-names">${attachments.length ? attachments.map(file => escapeHtml(file.name)).join('<br>') : '<span class="muted">Không có tệp</span>'}</td>
				<td><span class="status ${statusClass}">${escapeHtml(item.status)}</span></td>
				<td><div class="actions">
					<button class="button small" data-action="view" data-id="${escapeHtml(item.id)}" title="Xem giáo án"><i data-lucide="eye"></i><span>Xem</span></button>
					${attachments.length ? `<button class="button small icon-only" data-action="files" data-id="${escapeHtml(item.id)}" title="Tải tệp đính kèm" aria-label="Tải tệp đính kèm"><i data-lucide="paperclip"></i></button>` : ''}
					<button class="button small icon-only" data-action="notes" data-id="${escapeHtml(item.id)}" title="Ghi chú" aria-label="Ghi chú"><i data-lucide="message-square-text"></i></button>
					${item.status === 'Chờ phê duyệt' && item.recipientId === currentUser.id ? `<button class="button small primary" data-action="approve" data-id="${escapeHtml(item.id)}" title="Phê duyệt"><i data-lucide="check"></i><span>Duyệt</span></button><button class="button small danger" data-action="reject" data-id="${escapeHtml(item.id)}" title="Từ chối phê duyệt"><i data-lucide="x"></i><span>Từ chối</span></button>` : ''}
				</div></td>`;
			tbody.append(row);
		});
		if (!filtered.length) tbody.innerHTML = '<tr><td class="empty-row" colspan="7">Không tìm thấy giáo án phù hợp.</td></tr>';
		document.getElementById('total-count').textContent = String(documents.length).padStart(2, '0');
		document.getElementById('pending-count').textContent = String(documents.filter(item => item.status === 'Chờ phê duyệt').length).padStart(2, '0');
		document.getElementById('approved-count').textContent = String(documents.filter(item => item.status === 'Đã phê duyệt').length).padStart(2, '0');
		activateIcons(tbody);
	}

	async function reload() {
		documents = (await api('/api/documents')).documents;
		render();
	}

	function renderNotes(item) {
		const list = document.getElementById('note-list');
		list.replaceChildren();
		if (!item.notes.length) list.innerHTML = '<p class="muted">Chưa có ghi chú cho giáo án này.</p>';
		item.notes.forEach(note => {
			const entry = document.createElement('div');
			entry.className = 'note';
			entry.innerHTML = `<strong>${escapeHtml(note.author)}</strong><time>${escapeHtml(formatDate(note.at))}</time><p>${escapeHtml(note.text)}</p>`;
			list.append(entry);
		});
		document.getElementById('note-document-title').textContent = item.title;
	}

	tbody.addEventListener('click', async event => {
		const button = event.target.closest('button[data-action]');
		if (!button) return;
		activeId = button.dataset.id;
		const item = documents.find(entry => entry.id === activeId);
		if (!item) return;
		try {
			if (button.dataset.action === 'view') {
				document.getElementById('preview-title').textContent = item.title;
				const metadata = document.getElementById('preview-meta');
				metadata.replaceChildren();
				[
					['Loại giáo án', courseLabel(item)],
					['Người gửi', `${item.sender} · ${item.senderRole}`],
					['Người nhận', `${item.recipient} · ${item.recipientRole}`],
					['Thời gian gửi', formatDate(item.sentAt)]
				].forEach(([label, value]) => {
					const detail = document.createElement('div');
					detail.className = 'preview-detail';
					const detailLabel = document.createElement('span');
					detailLabel.textContent = label;
					const detailValue = document.createElement('strong');
					detailValue.textContent = value;
					detail.append(detailLabel, detailValue);
					metadata.append(detail);
				});
				const previewFiles = document.getElementById('preview-files');
				previewFiles.replaceChildren();
				if (!item.attachments.length) {
					const empty = document.createElement('p');
					empty.className = 'muted';
					empty.textContent = 'Giáo án cũ này không có tệp đính kèm.';
					previewFiles.append(empty);
				} else {
					item.attachments.forEach(file => {
						const entry = document.createElement('div');
						entry.className = 'file-entry';
						const name = document.createElement('span');
						name.textContent = file.name;
						const download = document.createElement('button');
						download.className = 'button small';
						download.type = 'button';
						download.innerHTML = '<i data-lucide="download"></i>Tải xuống';
						download.addEventListener('click', () => downloadAttachment(file).catch(error => showError('Không tải được tệp', error)));
						entry.append(name, download);
						previewFiles.append(entry);
					});
					activateIcons(previewFiles);
				}
				previewDialog.showModal();
				activateIcons(previewDialog);
			} else if (button.dataset.action === 'files') {
				document.getElementById('files-title').textContent = `Tệp đính kèm · ${item.title}`;
				const list = document.getElementById('files-list');
				list.replaceChildren();
				item.attachments.forEach(file => {
					const entry = document.createElement('div');
					entry.className = 'file-entry';
					const name = document.createElement('span');
					name.textContent = file.name;
					const download = document.createElement('button');
					download.className = 'button small';
					download.innerHTML = '<i data-lucide="download"></i>Tải xuống';
					download.addEventListener('click', () => downloadAttachment(file).catch(error => showError('Không tải được tệp', error)));
					entry.append(name, download);
					list.append(entry);
				});
				activateIcons(list);
				filesDialog.showModal();
			} else if (button.dataset.action === 'notes') {
				renderNotes(item);
				notesDialog.showModal();
			} else if (button.dataset.action === 'approve' && item.recipientId === currentUser.id) {
				document.getElementById('approve-title').textContent = item.title;
				approveDialog.showModal();
			} else if (button.dataset.action === 'reject' && item.recipientId === currentUser.id) {
				document.getElementById('reject-title').textContent = item.title;
				document.getElementById('reject-reason').value = '';
				rejectDialog.showModal();
			}
		} catch (error) {
			showError('Không thể mở giáo án', error);
		}
	});

	document.getElementById('add-note').addEventListener('click', async () => {
		const input = document.getElementById('note-input');
		const text = input.value.trim();
		if (!text) { input.focus(); return; }
		try {
			await api(`/api/documents/${encodeURIComponent(activeId)}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
			input.value = '';
			await reload();
			const item = documents.find(entry => entry.id === activeId);
			if (item) renderNotes(item);
		} catch (error) {
			showError('Không gửi được ghi chú', error);
		}
	});

	document.getElementById('confirm-approve').addEventListener('click', async () => {
		try {
			await api(`/api/documents/${encodeURIComponent(activeId)}/approve`, { method: 'POST', body: '{}' });
			approveDialog.close();
			await reload();
		} catch (error) {
			showError('Không phê duyệt được giáo án', error);
		}
	});

	document.getElementById('confirm-reject').addEventListener('click', async () => {
		const reason = document.getElementById('reject-reason').value.trim();
		try {
			await api(`/api/documents/${encodeURIComponent(activeId)}/reject`, {
				method: 'POST',
				body: JSON.stringify({ reason })
			});
			rejectDialog.close();
			showToast('Đã từ chối phê duyệt giáo án.', 'success');
			await reload();
		} catch (error) {
			showError('Không từ chối được giáo án', error);
		}
	});

	search.addEventListener('input', render);
	filter.addEventListener('change', render);
	await reload();
}

async function setupFileSubmission() {
	const titleInput = document.getElementById('document-title');
	const recipientSelect = document.getElementById('document-recipient');
	const courseTypeSelect = document.getElementById('course-type');
	const courseSubtypeSelect = document.getElementById('course-subtype');
	const courseSubtypeField = document.getElementById('course-subtype-field');
	const workspace = document.getElementById('submission-workspace');
	const fileInput = document.getElementById('file-input');
	const attachmentList = document.getElementById('attachment-list');
	const wordTemplateList = document.getElementById('word-template-list');
	const draftsList = document.getElementById('drafts-list');
	const draftSearch = document.getElementById('draft-search');
	const message = document.getElementById('editor-message');
	let currentDraftId = null;
	let attachments = [];
	let drafts = [];
	let wordTemplates = [];
	let searchQuery = '';

	function notify(text) {
		message.textContent = text;
		showToast(text);
	}

	function updateSubtypes(selected = '') {
		const options = SUBTYPES[courseTypeSelect.value] || [];
		courseSubtypeField.hidden = !options.length;
		courseSubtypeField.firstChild.textContent = courseTypeSelect.value === 'Hậu cần kỹ thuật'
			? 'Chọn nội dung hậu cần kỹ thuật'
			: 'Chọn nội dung quân sự';
		courseSubtypeSelect.replaceChildren(new Option('-- Chọn nội dung --', ''));
		options.forEach(item => courseSubtypeSelect.add(new Option(item, item)));
		if (options.includes(selected)) courseSubtypeSelect.value = selected;
		workspace.hidden = !courseTypeSelect.value || (options.length > 0 && !courseSubtypeSelect.value);
		renderWordTemplates();
	}

	async function updateRecipients(selectedId = '') {
		const result = await api('/api/recipients');
		recipientSelect.replaceChildren(new Option('-- Chọn người nhận --', ''));
		result.recipients.forEach(user => recipientSelect.add(new Option(`${user.name} · ${user.role}`, user.id)));
		if (selectedId && result.recipients.some(user => user.id === selectedId)) recipientSelect.value = selectedId;
		recipientSelect.disabled = result.recipients.length === 0;
	}

	function renderWordTemplates() {
		wordTemplateList.replaceChildren();
		const matching = wordTemplates.filter(template =>
			template.courseType === courseTypeSelect.value
			&& (!template.courseSubtype || template.courseSubtype === courseSubtypeSelect.value)
		);
		if (!matching.length) {
			const empty = document.createElement('span');
			empty.className = 'muted';
			empty.textContent = courseTypeSelect.value
				? 'Chưa có mẫu Word cho danh mục này.'
				: 'Chọn loại giáo án để xem các mẫu Word phù hợp.';
			wordTemplateList.append(empty);
			return;
		}
		matching.forEach(template => {
			const item = document.createElement('div');
			item.className = 'word-template-item';
			const info = document.createElement('div');
			info.className = 'word-template-info';
			const name = document.createElement('strong');
			name.textContent = template.fileName;
			const category = document.createElement('span');
			category.textContent = `${template.courseSubtype || template.courseType} · ${(template.sizeBytes / 1024).toFixed(1)} KB`;
			info.append(name, category);
			const download = document.createElement('button');
			download.className = 'button small';
			download.type = 'button';
			download.dataset.wordTemplateId = template.id;
			download.innerHTML = '<i data-lucide="download"></i>Tải mẫu Word';
			item.append(info, download);
			wordTemplateList.append(item);
		});
		activateIcons(wordTemplateList);
	}

	function renderAttachments() {
		attachmentList.replaceChildren();
		if (!attachments.length) {
			const empty = document.createElement('span');
			empty.className = 'muted';
			empty.textContent = 'Chưa chọn tệp giáo án.';
			attachmentList.append(empty);
			return;
		}
		attachments.forEach((file, index) => {
			const item = document.createElement('div');
			item.className = 'attachment-item';
			const info = document.createElement('div');
			info.className = 'attachment-info';
			const name = document.createElement('strong');
			name.textContent = file.name;
			const size = document.createElement('span');
			size.textContent = `${file.type || 'Tệp'} · ${(file.size / 1024).toFixed(1)} KB`;
			info.append(name, size);
			const remove = document.createElement('button');
			remove.className = 'button icon-only';
			remove.type = 'button';
			remove.setAttribute('aria-label', `Gỡ ${file.name}`);
			remove.title = 'Gỡ tệp';
			remove.innerHTML = '<i data-lucide="x"></i>';
			remove.addEventListener('click', async () => {
				try {
					if (!file.pending && currentDraftId) {
						await api(`/api/drafts/${encodeURIComponent(currentDraftId)}/attachments/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
					}
					attachments.splice(index, 1);
					renderAttachments();
				} catch (error) {
					showError('Không gỡ được tệp', error);
				}
			});
			item.append(info, remove);
			attachmentList.append(item);
		});
		activateIcons(attachmentList);
	}

	function renderDrafts() {
		const query = searchQuery.toLocaleLowerCase('vi');
		const filtered = drafts.filter(draft => {
			const fileNames = (draft.attachments || []).map(file => file.name).join(' ');
			return `${draft.title} ${fileNames}`.toLocaleLowerCase('vi').includes(query);
		});
		draftsList.replaceChildren();
		if (!filtered.length) {
			const empty = document.createElement('p');
			empty.className = 'empty-row';
			empty.textContent = query ? 'Không tìm thấy bản nháp phù hợp.' : 'Chưa có giáo án nháp.';
			draftsList.append(empty);
			return;
		}
		filtered.forEach(draft => {
			const row = document.createElement('article');
			row.className = 'draft-row';
			const copy = document.createElement('div');
			copy.className = 'draft-copy';
			const title = document.createElement('strong');
			title.textContent = draft.title;
			const detail = document.createElement('span');
			detail.textContent = `${courseLabel(draft)} · ${formatDate(draft.updatedAt)} · ${(draft.attachments || []).length} tệp`;
			copy.append(title, detail);
			const actions = document.createElement('div');
			actions.className = 'draft-actions';
			const edit = document.createElement('button');
			edit.className = 'button small';
			edit.type = 'button';
			edit.dataset.action = 'edit-draft';
			edit.dataset.id = draft.id;
			edit.innerHTML = '<i data-lucide="file-pen-line"></i>Mở';
			const remove = document.createElement('button');
			remove.className = 'button small icon-only';
			remove.type = 'button';
			remove.dataset.action = 'delete-draft';
			remove.dataset.id = draft.id;
			remove.title = 'Xóa bản nháp';
			remove.setAttribute('aria-label', `Xóa bản nháp ${draft.title}`);
			remove.innerHTML = '<i data-lucide="trash-2"></i>';
			actions.append(edit, remove);
			row.append(copy, actions);
			draftsList.append(row);
		});
		activateIcons(draftsList);
	}

	async function reloadDrafts() {
		drafts = (await api('/api/drafts')).drafts;
		renderDrafts();
	}

	async function saveDraft(showMessage = true) {
		const title = titleInput.value.trim();
		if (!title) return notify('Nhập tiêu đề giáo án trước khi lưu.');
		if (!courseTypeSelect.value || ((SUBTYPES[courseTypeSelect.value] || []).length && !courseSubtypeSelect.value)) {
			return notify('Hãy chọn loại giáo án và nội dung tương ứng trước khi lưu.');
		}
		try {
			const result = await api('/api/drafts', {
				method: 'POST',
				body: JSON.stringify({
					id: currentDraftId || crypto.randomUUID(),
					title,
					courseType: courseTypeSelect.value,
					courseSubtype: courseSubtypeSelect.value,
					recipientId: recipientSelect.value || null
				})
			});
			currentDraftId = result.draft.id;
			const pending = attachments.filter(file => file.pending);
			for (let index = 0; index < pending.length; index += 5) {
				const formData = new FormData();
				pending.slice(index, index + 5).forEach(file => formData.append('files', file.file, file.name));
				await api(`/api/drafts/${encodeURIComponent(currentDraftId)}/attachments`, { method: 'POST', body: formData });
			}
			attachments = (await api('/api/drafts')).drafts.find(draft => draft.id === currentDraftId)?.attachments || [];
			await reloadDrafts();
			renderAttachments();
			if (showMessage) message.textContent = 'Đã lưu giáo án nháp.';
			return result.draft;
		} catch (error) {
			notify(error.message);
			console.error(error);
			return null;
		}
	}

	courseTypeSelect.addEventListener('change', () => updateSubtypes());
	courseSubtypeSelect.addEventListener('change', () => {
		const subtypeRequired = (SUBTYPES[courseTypeSelect.value] || []).length > 0;
		workspace.hidden = !courseTypeSelect.value || (subtypeRequired && !courseSubtypeSelect.value);
		renderWordTemplates();
	});
	fileInput.addEventListener('change', () => {
		const allowed = [];
		for (const file of Array.from(fileInput.files)) {
			const extension = file.name.split('.').pop().toLocaleLowerCase('en-US');
			if (!['doc', 'docx', 'pdf'].includes(extension)) {
				notify(`Tệp "${file.name}" không đúng định dạng Word hoặc PDF.`);
				continue;
			}
			if (file.size > 15 * 1024 * 1024) {
				notify(`Tệp "${file.name}" vượt quá giới hạn 15 MB.`);
				continue;
			}
			allowed.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, file, pending: true });
		}
		attachments.push(...allowed);
		fileInput.value = '';
		renderAttachments();
	});
	document.getElementById('save-draft').addEventListener('click', () => saveDraft());
	document.getElementById('submit-document').addEventListener('click', async () => {
		if (!attachments.length) return notify('Tải lên ít nhất một tệp Word hoặc PDF trước khi gửi.');
		if (!titleInput.value.trim()) return notify('Nhập tiêu đề giáo án trước khi gửi.');
		if (!courseTypeSelect.value || ((SUBTYPES[courseTypeSelect.value] || []).length && !courseSubtypeSelect.value)) {
			return notify('Hãy chọn loại giáo án và nội dung tương ứng trước khi gửi.');
		}
		if (!recipientSelect.value) return notify('Chọn người nhận giáo án.');
		const draft = await saveDraft(false);
		if (!draft) return;
		try {
			await api('/api/documents', {
				method: 'POST',
				body: JSON.stringify({
					draftId: currentDraftId,
					title: titleInput.value.trim(),
					courseType: courseTypeSelect.value,
					courseSubtype: courseSubtypeSelect.value,
					recipientId: recipientSelect.value
				})
			});
			message.textContent = `Đã gửi giáo án “${titleInput.value.trim()}” để phê duyệt.`;
			currentDraftId = null;
			await reloadDrafts();
			window.setTimeout(() => { window.location.href = 'dashboard.html'; }, 650);
		} catch (error) {
			notify(error.message);
			console.error(error);
		}
	});
	document.getElementById('draft-search').addEventListener('input', () => {
		searchQuery = draftSearch.value;
		renderDrafts();
	});
	draftsList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-action]');
		if (!button) return;
		const draft = drafts.find(item => item.id === button.dataset.id);
		if (!draft) return;
		try {
			if (button.dataset.action === 'edit-draft') {
				currentDraftId = draft.id;
				titleInput.value = draft.title;
				courseTypeSelect.value = draft.courseType;
				updateSubtypes(draft.courseSubtype);
				await updateRecipients(draft.recipientId);
				attachments = (draft.attachments || []).map(file => ({ ...file, pending: false }));
				renderAttachments();
				message.textContent = `Đang chỉnh sửa giáo án nháp “${draft.title}”.`;
				window.scrollTo({ top: 0, behavior: 'smooth' });
			} else if (button.dataset.action === 'delete-draft') {
				if (!window.confirm(`Xóa giáo án nháp “${draft.title}” và các tệp đính kèm?`)) return;
				await api(`/api/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
				if (currentDraftId === draft.id) {
					currentDraftId = null;
					titleInput.value = '';
					attachments = [];
					renderAttachments();
				}
				await reloadDrafts();
			}
		} catch (error) {
			showError('Không xử lý được giáo án nháp', error);
		}
	});
	wordTemplateList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-word-template-id]');
		const template = wordTemplates.find(item => item.id === button?.dataset.wordTemplateId);
		if (!template) return;
		try {
			await downloadWordTemplate(template);
		} catch (error) {
			showError('Không tải được mẫu Word', error);
		}
	});

	await updateRecipients();
	wordTemplates = (await api('/api/word-templates')).templates;
	updateSubtypes();
	await reloadDrafts();
	renderAttachments();
}

async function setupManagement() {
	const list = document.getElementById('member-list');
	const form = document.getElementById('member-form');
	const roleSelect = document.getElementById('member-role');
	const managerSelect = document.getElementById('member-manager');
	const wordTemplateForm = document.getElementById('word-template-form');
	const wordTemplateCourseType = document.getElementById('word-template-course-type');
	const wordTemplateCourseSubtype = document.getElementById('word-template-course-subtype');
	const wordTemplateCourseSubtypeField = document.getElementById('word-template-course-subtype-field');
	const wordTemplateFile = document.getElementById('word-template-file');
	const wordTemplateList = document.getElementById('managed-word-template-list');
	const deleteTemplateDialog = document.getElementById('delete-template-dialog');
	const deleteTemplateFileName = document.getElementById('delete-template-filename');
	const deleteTemplateError = document.getElementById('delete-template-error');
	const confirmTemplateDelete = document.getElementById('confirm-template-delete');
	let pendingTemplateDelete = null;
	let users = [];
	let wordTemplates = [];

	function updateWordTemplateSubtypes(selected = '') {
		const options = SUBTYPES[wordTemplateCourseType.value] || [];
		wordTemplateCourseSubtypeField.hidden = !options.length;
		wordTemplateCourseSubtype.replaceChildren(new Option('Áp dụng cho mọi nội dung', ''));
		options.forEach(item => wordTemplateCourseSubtype.add(new Option(item, item)));
		if (options.includes(selected)) wordTemplateCourseSubtype.value = selected;
	}

	function updateManagers() {
		const level = Number(roleSelect.value);
		managerSelect.replaceChildren(new Option(level === 5 ? 'Bộ Quốc phòng' : '-- Chọn chỉ huy trực tiếp --', ''));
		users.filter(user => !user.isAdmin && Number(user.level) === level + 1)
			.forEach(user => managerSelect.add(new Option(`${user.name} · ${user.role}`, user.id)));
		managerSelect.required = level < 5;
	}

	function renderUsers() {
		list.replaceChildren();
		users.filter(user => !user.isAdmin).forEach(user => {
			const row = document.createElement('tr');
			row.innerHTML = `<td><strong>${escapeHtml(user.name)}</strong></td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.manager || 'Bộ Quốc phòng')}</td>`;
			list.append(row);
		});
		[1, 2, 3, 4, 5].forEach(level => {
			document.querySelector(`[data-count-level="${level}"]`).textContent =
				`${users.filter(user => !user.isAdmin && Number(user.level) === level).length} người`;
		});
	}

	async function reloadUsers() {
		users = (await api('/api/management/users')).users;
		updateManagers();
		renderUsers();
	}

	function renderWordTemplates() {
		wordTemplateList.replaceChildren();
		if (!wordTemplates.length) {
			const empty = document.createElement('p');
			empty.className = 'empty-row';
			empty.textContent = 'Chưa có tệp Word mẫu.';
			wordTemplateList.append(empty);
			return;
		}
		wordTemplates.forEach(template => {
			const card = document.createElement('article');
			card.className = 'managed-template-card';
			const heading = document.createElement('div');
			heading.className = 'managed-template-heading';
			const title = document.createElement('strong');
			title.textContent = template.fileName;
			const category = document.createElement('span');
			category.textContent = template.courseSubtype
				? `${template.courseType} · ${template.courseSubtype}`
				: `${template.courseType} · Mọi nội dung`;
			heading.append(title, category);
			const detail = document.createElement('p');
			detail.textContent = `${(template.sizeBytes / 1024).toFixed(1)} KB · Tệp gốc được lưu không chuyển đổi`;
			const remove = document.createElement('button');
			remove.className = 'button small danger';
			remove.type = 'button';
			remove.dataset.wordTemplateDelete = template.id;
			remove.textContent = 'Xóa';
			const actions = document.createElement('div');
			actions.className = 'managed-template-actions';
			actions.append(remove);
			card.append(heading, detail, actions);
			wordTemplateList.append(card);
		});
	}

	async function reloadWordTemplates() {
		wordTemplates = (await api('/api/management/word-templates')).templates;
		renderWordTemplates();
	}

	const page = document.body.dataset.page;
	if (page === 'management') {
		roleSelect.addEventListener('change', updateManagers);
		form.addEventListener('submit', async event => {
			event.preventDefault();
			try {
				await api('/api/management/users', {
					method: 'POST',
					body: JSON.stringify({
						name: document.getElementById('member-name').value.trim(),
						username: document.getElementById('member-username').value.trim(),
						password: document.getElementById('member-password').value,
						level: Number(roleSelect.value),
						managerId: managerSelect.value || null
					})
				});
				form.reset();
				roleSelect.value = '1';
				showToast('Đã tạo tài khoản thành viên.', 'success');
				await reloadUsers();
			} catch (error) {
				showToast(error.message);
			}
		});
		await reloadUsers();
		return;
	}

	wordTemplateCourseType.addEventListener('change', () => updateWordTemplateSubtypes());
	wordTemplateForm.addEventListener('submit', async event => {
		event.preventDefault();
		if (!wordTemplateFile.files.length) {
			showToast('Chọn tệp Word định dạng .doc hoặc .docx.');
			return;
		}
		try {
			const body = new FormData();
			body.append('courseType', wordTemplateCourseType.value);
			body.append('courseSubtype', wordTemplateCourseSubtype.value);
			body.append('file', wordTemplateFile.files[0]);
			await api('/api/management/word-templates', { method: 'POST', body });
			showToast('Đã tải lên tệp Word mẫu gốc, không chuyển đổi định dạng.', 'success');
			wordTemplateForm.reset();
			wordTemplateCourseType.value = '';
			updateWordTemplateSubtypes();
			await reloadWordTemplates();
		} catch (error) {
			showError('Không tải lên được tệp Word mẫu', error);
		}
	});
	wordTemplateList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-word-template-delete]');
		if (!button) return;
		const template = wordTemplates.find(item => item.id === button.dataset.wordTemplateDelete);
		if (!template) return;
		pendingTemplateDelete = template;
		deleteTemplateFileName.textContent = template.fileName;
		deleteTemplateError.hidden = true;
		deleteTemplateError.textContent = '';
		deleteTemplateDialog.showModal();
		activateIcons(deleteTemplateDialog);
		document.getElementById('cancel-template-delete').focus();
	});
	document.getElementById('cancel-template-delete').addEventListener('click', () => {
		deleteTemplateDialog.close();
	});
	confirmTemplateDelete.addEventListener('click', async () => {
		if (!pendingTemplateDelete) return;
		confirmTemplateDelete.disabled = true;
		confirmTemplateDelete.innerHTML = '<i data-lucide="loader-circle"></i>Đang xóa...';
		activateIcons(confirmTemplateDelete);
		try {
			await api(`/api/management/word-templates/${encodeURIComponent(pendingTemplateDelete.id)}`, { method: 'DELETE' });
			deleteTemplateDialog.close();
			pendingTemplateDelete = null;
			showToast('Đã xóa tệp Word mẫu.', 'success');
			await reloadWordTemplates();
		} catch (error) {
			deleteTemplateError.textContent = `Không xóa được mẫu Word: ${error.message}`;
			deleteTemplateError.hidden = false;
		} finally {
			confirmTemplateDelete.disabled = false;
			confirmTemplateDelete.innerHTML = '<i data-lucide="trash-2"></i>Xóa mẫu';
			activateIcons(confirmTemplateDelete);
		}
	});
	deleteTemplateDialog.addEventListener('close', () => {
		pendingTemplateDelete = null;
	});
	await reloadWordTemplates();
}

async function setupLogin() {
	const form = document.getElementById('login-form');
	try {
		const result = await api('/api/auth/me');
		currentUser = result.user;
		window.location.replace(currentUser.isAdmin ? 'quan-ly.html' : 'dashboard.html');
		return;
	} catch (error) {
		if (!error.message.includes('đăng nhập') && !error.message.includes('Phiên đăng nhập')) {
			const message = `Không kết nối được API: ${error.message}`;
			document.getElementById('login-error').textContent = message;
			showToast(message);
		}
	}
	form.addEventListener('submit', async event => {
		event.preventDefault();
		const error = document.getElementById('login-error');
		const submit = form.querySelector('button[type="submit"]');
		error.textContent = '';
		submit.disabled = true;
		try {
			const result = await api('/api/auth/login', {
				method: 'POST',
				body: JSON.stringify({
					username: document.getElementById('login-email').value.trim(),
					password: document.getElementById('login-password').value
				})
			});
			currentUser = result.user;
			window.location.href = currentUser.isAdmin ? 'quan-ly.html' : 'dashboard.html';
		} catch (loginError) {
			error.textContent = loginError.message;
			showToast(loginError.message);
		} finally {
			submit.disabled = false;
		}
	});
	document.getElementById('toggle-password').addEventListener('click', event => {
		const input = document.getElementById('login-password');
		const visible = input.type === 'password';
		input.type = visible ? 'text' : 'password';
		const button = event.currentTarget;
		button.title = visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
		button.setAttribute('aria-label', button.title);
		button.innerHTML = `<i data-lucide="${visible ? 'eye-off' : 'eye'}"></i>`;
		activateIcons(button);
	});
}

document.addEventListener('click', async event => {
	if (!event.target.closest('[data-logout]')) return;
	try {
		await api('/api/auth/logout', { method: 'POST', body: '{}' });
		window.location.href = 'index.html';
	} catch (error) {
		showError('Không đăng xuất được', error);
	}
});

async function bootstrap() {
	const page = document.body.dataset.page;
	if (page === 'login') {
		await setupLogin();
		activateIcons();
		return;
	}
	try {
		currentUser = (await api('/api/auth/me')).user;
		const isAdminPage = ['management', 'word-templates'].includes(page);
		if (currentUser.isAdmin && !isAdminPage) {
			window.location.replace('quan-ly.html');
			return;
		}
		if (!currentUser.isAdmin && isAdminPage) {
			window.location.replace('dashboard.html');
			return;
		}
		await loadNavigation(page);
		document.querySelectorAll('[data-admin-only]').forEach(element => { element.hidden = !currentUser.isAdmin; });
		document.querySelectorAll('[data-business-only]').forEach(element => { element.hidden = currentUser.isAdmin; });
		document.querySelector('[data-topbar-action="create"]').hidden = page !== 'dashboard' || currentUser.isAdmin;
		document.querySelector('[data-topbar-action="dashboard"]').hidden = page !== 'submission';
		document.querySelectorAll('.user-copy').forEach(copy => {
			copy.querySelector('strong').textContent = currentUser.name;
			copy.querySelector('span').textContent = currentUser.role || ROLES.get(Number(currentUser.level));
		});
		document.querySelectorAll('.avatar').forEach(avatar => {
			avatar.textContent = currentUser.name.split(/\s+/).slice(-2).map(part => part[0]).join('');
		});
		if (page === 'dashboard') await setupDashboard();
		else if (page === 'submission') await setupFileSubmission();
		else if (['management', 'word-templates'].includes(page)) await setupManagement();
		document.body.hidden = false;
		activateIcons();
	} catch (error) {
		if (error.message.includes('đăng nhập') || error.message.includes('Phiên đăng nhập')) {
			window.location.replace('index.html');
			return;
		}
		document.body.hidden = false;
		showError('Không kết nối được API. Hãy kiểm tra backend và PostgreSQL', error);
	}
}

bootstrap().catch(error => {
	document.body.hidden = false;
	showError('Không thể tải ứng dụng', error);
});
