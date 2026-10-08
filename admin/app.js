import { createClient, validateConfig } from './client.js';
import { createDemoClient } from './demo.js';

const $ = (id) => document.getElementById(id);
const isBlogPath = (path) => typeof path === 'string' && /^_blog\/[^/\\\x00-\x1f]+\.md$/.test(path);
const isBlogEntry = (entry) => entry?.collection === 'blog' && (!entry.source_path || isBlogPath(entry.source_path));
const statuses = {
  draft: '작성 중', submitted: '검토 대기', changes_requested: '수정 요청',
  publishing: '반영 처리 중', published: '반영 요청됨',
};
const filters = {
  all: ['블로그 글', '연구실 이야기와 활동 사진의 진행 상태를 확인하세요.'],
  draft: ['작성 중', '아직 제출하지 않은 글을 이어서 작성하세요.'],
  submitted: ['검토 대기', '제출된 글은 관리자 확인을 기다리고 있습니다.'],
  changes_requested: ['수정 요청', '관리자의 의견을 확인하고 내용을 수정하세요.'],
  published: ['반영 요청됨', '승인된 글은 홈페이지 반영을 요청한 상태입니다.'],
};
const state = {
  client: null, demo: false, profile: null, entries: [], current: null,
  assets: [], filter: 'all', search: '', dirty: false,
  snapshot: '', busy: false, dialogResolver: null,
  catalog: [], catalogSearch: '',
};
const koreanToday = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const isAdmin = () => state.profile?.role === 'admin';
const editable = () => !state.current || (
  ['draft', 'changes_requested'].includes(state.current.status) &&
  (isAdmin() || state.current.author_id === state.profile?.id)
);
const configured = () => validateConfig(window.CMS_CONFIG);
const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
function safeUrl(value, images = false) {
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    if (images && (url.protocol === 'blob:' || /^data:image\/(png|jpeg|webp);base64,/i.test(value))) return url.href;
  } catch { /* Malformed URLs do not create image or link elements. */ }
  return '';
}
function feedback(id, text, error = false) {
  const element = $(id);
  element.textContent = text;
  element.classList.toggle('error', error);
  element.classList.toggle('success', !error);
  element.hidden = !text;
}
function errorText(error) {
  const message = error?.message || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (/Failed to fetch|NetworkError|network/i.test(message)) return '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  if (/Invalid login credentials/i.test(message)) return '아이디(또는 이메일)와 비밀번호를 확인해 주세요.';
  if (/Email not confirmed/i.test(message)) return '계정의 이메일 확인을 먼저 완료해 주세요.';
  if (/expired|JWT|session|로그인/i.test(message) && !/email|credentials/i.test(message)) return '로그인이 만료되었을 수 있습니다. 다시 로그인한 뒤 시도해 주세요.';
  return message;
}
function showView(name) {
  for (const id of ['auth-view', 'password-view', 'workspace']) $(id).hidden = id !== name;
  $('signout').hidden = name === 'auth-view';
  $('demo-banner').hidden = !state.demo;
}
function showContent(name) {
  for (const id of ['list-view', 'editor-view', 'catalog-view']) $(id).hidden = id !== name;
}
function focusHeading(id) {
  const heading = $(id);
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['new-entry', 'refresh-button', 'catalog-button', 'back-button', 'catalog-back', 'demo-role', 'signout']) $(id).disabled = busy;
  if (!$('editor-view').hidden) renderEditorControls();
}
function setDirty() {
  state.dirty = state.snapshot !== snapshot();
  $('save-state').textContent = state.dirty ? '저장하지 않은 변경 사항이 있습니다.' : (state.current ? '저장됨' : '');
}
function readEntry() {
  return {
    ...(state.current?.id ? { id: state.current.id } : {}),
    collection: 'blog',
    title: $('entry-title').value.trim(), date: $('entry-date').value,
    body: $('entry-body').value, description: $('entry-description').value.trim(),
    image_alt: state.assets.length ? state.assets[0]?.alt || '' : state.current?.image_alt || '',
    image_caption: state.assets.length ? state.assets[0]?.caption || '' : state.current?.image_caption || '',
    assets: state.assets.map(({ path, name, mime, size, alt = '', caption = '' }) => ({ path, name, mime, size, alt, caption })),
  };
}
function snapshot() { return JSON.stringify(readEntry()); }
function markClean() {
  state.snapshot = snapshot();
  state.dirty = false;
  $('save-state').textContent = state.current ? '저장됨' : '';
}
function validForm() {
  $('entry-date').max = koreanToday();
  $('entry-title').setCustomValidity($('entry-title').value.trim() ? '' : '제목을 입력해 주세요.');
  if (!$('entry-form').reportValidity()) return false;
  if ($('entry-date').value > koreanToday()) {
    feedback('workspace-feedback', '게시 날짜는 오늘 또는 이전 날짜를 선택해 주세요.', true);
    $('entry-date').focus();
    return false;
  }
  if (state.assets.length > 10) {
    feedback('workspace-feedback', '사진은 최대 10장까지 추가할 수 있습니다.', true);
    return false;
  }
  return true;
}
function mergeEntry(entry) {
  if (!isBlogEntry(entry)) throw new Error('블로그 글을 확인할 수 없습니다.');
  const oldAssets = new Map(state.assets.map((asset) => [asset.path, asset]));
  state.current = entry;
  state.assets = (entry.assets || state.assets).map((asset) => ({ ...oldAssets.get(asset.path), ...asset }));
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.unshift(entry);
}
async function saveDraft() {
  if (!editable()) throw new Error('이 상태의 글은 수정할 수 없습니다.');
  if (!validForm()) return null;
  const result = await state.client.request('save', {
    entry: readEntry(), ...(state.current ? { version: state.current.version } : {}),
  });
  mergeEntry(result.entry);
  markClean();
  renderEditorControls();
  renderNavigation();
  return result.entry;
}
async function confirmLeave() {
  if (state.busy) return false;
  if (!state.dirty || $('editor-view').hidden) return true;
  const answer = await dialog({
    title: '작성 화면을 나갈까요?', description: '저장하지 않은 변경 사항이 사라집니다. 이어서 작성하려면 취소를 누르고 임시 저장해 주세요.',
    confirm: '저장하지 않고 나가기',
  });
  return answer !== null;
}
function dialog({ title, description, confirm = '확인', fields = [] }) {
  if (state.dialogResolver) return Promise.resolve(null);
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('dialog-confirm').textContent = confirm;
  $('dialog-fields').replaceChildren();
  feedback('dialog-feedback', '');
  for (const field of fields) {
    const label = node('label', '', field.label);
    label.htmlFor = `dialog-${field.name}`;
    const input = node(field.type === 'textarea' ? 'textarea' : 'input');
    input.id = `dialog-${field.name}`;
    input.name = field.name;
    input.required = field.required !== false;
    if (field.type === 'textarea') input.rows = 4;
    else input.type = field.type || 'text';
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.value) input.value = field.value;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (field.autocomplete) input.autocomplete = field.autocomplete;
    $('dialog-fields').append(label, input);
  }
  $('action-dialog').showModal();
  const first = $('dialog-fields').querySelector('input,textarea');
  (first || $('dialog-confirm')).focus();
  return new Promise((resolve) => { state.dialogResolver = resolve; });
}
function finishDialog(value) {
  const resolver = state.dialogResolver;
  state.dialogResolver = null;
  $('action-dialog').close();
  resolver?.(value);
}
function renderProfile() {
  const name = state.profile?.display_name || state.profile?.email?.split('@')[0] || '구성원';
  $('profile-name').textContent = name;
  $('profile-avatar').textContent = name.slice(0, 1).toUpperCase();
  $('profile-role').textContent = isAdmin() ? '관리자' : '구성원';
  $('admin-tools').hidden = !isAdmin();
  $('review-nav-label').textContent = isAdmin() ? '검토할 글' : '검토 대기';
  $('demo-role').value = state.profile?.role || 'editor';
}
function renderNavigation() {
  for (const key of ['all', 'draft', 'submitted', 'changes_requested', 'published']) {
    const count = key === 'all' ? state.entries.length : state.entries.filter((entry) => key === 'published' ? ['published', 'publishing'].includes(entry.status) : entry.status === key).length;
    $(`count-${key}`).textContent = count;
  }
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.classList.toggle('active', button.dataset.filter === state.filter);
    if (button.dataset.filter === state.filter) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
function statusChip(status) { return node('span', `status-chip status-${status}`, statuses[status] || status); }
function renderList() {
  const [title, description] = filters[state.filter];
  $('list-title').textContent = title;
  $('list-description').textContent = isAdmin() && state.filter === 'all' ? '제출된 블로그 글과 활동 사진을 검토하고 반영하세요.' : description;
  renderNavigation();
  const submittedCount = state.entries.filter((entry) => entry.status === 'submitted').length;
  $('review-summary').hidden = !submittedCount || state.filter !== 'all';
  $('review-summary-title').textContent = isAdmin() ? `검토를 기다리는 글이 ${submittedCount}개 있어요.` : `${submittedCount}개의 글을 제출했어요.`;
  $('review-summary-description').textContent = isAdmin() ? '글과 사진을 확인한 뒤 승인하거나 수정 의견을 남겨 주세요.' : '관리자가 확인하면 진행 상태가 여기에 표시됩니다.';
  const needle = state.search.toLocaleLowerCase();
  const entries = state.entries.filter((entry) =>
    (state.filter === 'all' || (state.filter === 'published' ? ['published', 'publishing'].includes(entry.status) : entry.status === state.filter)) &&
    (!needle || `${entry.title} ${entry.author_name || ''} ${entry.description || ''} ${entry.body || ''}`.toLocaleLowerCase().includes(needle))
  ).sort((a, b) => (b.updated_at || b.date || '').localeCompare(a.updated_at || a.date || ''));
  $('result-count').textContent = `${entries.length}개의 글`;
  $('entries').replaceChildren();
  if (!entries.length) {
    const empty = node('div', 'empty-state');
    empty.append(node('span', 'empty-symbol', '▤'), node('h2', '', state.search ? '검색 결과가 없습니다.' : '아직 블로그 글이 없습니다.'), node('p', '', state.search ? '검색어를 바꿔 보세요.' : '활동 사진과 함께 연구실의 이야기를 기록해 보세요.'));
    if (!state.search) {
      const button = node('button', 'button secondary', '새 글 작성');
      button.type = 'button'; button.addEventListener('click', newEntry); empty.append(button);
    }
    $('entries').append(empty);
  }
  for (const entry of entries) {
    const button = node('button', 'entry-card'); button.type = 'button';
    const info = node('div', 'entry-info');
    const line = node('div', 'entry-topline'); line.append(node('span', 'muted', entry.date || ''));
    info.append(line, node('h3', '', entry.title || '제목 없는 글'));
    if (entry.description) info.append(node('p', 'entry-description', entry.description));
    info.append(node('p', 'entry-meta', `${entry.author_name || (entry.author_id === state.profile?.id ? '내가 작성' : '구성원')} · ${entry.updated_at ? `${formatDate(entry.updated_at)} 수정` : '최근 작성'}`));
    button.append(info, statusChip(entry.status), node('span', 'entry-arrow', '→'));
    button.addEventListener('click', () => openEntry(entry)); $('entries').append(button);
  }
}
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(date);
}
async function loadData() {
  const data = await state.client.request('list');
  state.profile = data.profile;
  state.entries = (data.entries || []).filter(isBlogEntry);
  renderProfile(); renderList();
}
async function startDemo() {
  if (!(await confirmLeave())) return;
  setBusy(true);
  feedback('auth-feedback', '체험 화면을 준비하고 있습니다.');
  try {
    state.client = createDemoClient(); state.demo = true;
    await loadData();
    state.current = null; state.dirty = false;
    showView('workspace'); showContent('list-view');
    const url = new URL(location.href); url.searchParams.set('demo', '1');
    history.replaceState(null, '', `${url.pathname}${url.search}`);
    focusHeading('list-title');
  } catch (error) {
    state.demo = false;
    feedback('auth-feedback', `체험 화면을 열지 못했습니다. ${errorText(error)}`, true);
  } finally { setBusy(false); }
}
async function newEntry() {
  if (!(await confirmLeave())) return;
  state.current = null; state.assets = [];
  populateEditor({ collection: 'blog', title: '', date: koreanToday(), body: '', description: '' });
  showContent('editor-view');
  renderEditorControls(); renderPhotos(); markClean();
  $('entry-title').focus();
  feedback('workspace-feedback', '');
}
async function openEntry(entry) {
  if (!isBlogEntry(entry)) return;
  if (!(await confirmLeave())) return;
  setBusy(true);
  try {
    const result = await state.client.request('assets', { id: entry.id });
    state.current = entry;
    state.assets = result.assets || entry.assets || [];
    populateEditor(entry); showContent('editor-view');
    renderPhotos(); markClean();
    feedback('workspace-feedback', '');
    focusHeading('editor-title');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
function populateEditor(entry) {
  $('upload-status').textContent = '';
  for (const key of ['title', 'date', 'body', 'description']) $(`entry-${key}`).value = entry[key] || '';
  if (!$('entry-date').value) $('entry-date').value = koreanToday();
  $('entry-title').setCustomValidity('');
  $('entry-date').max = koreanToday();
  setTab('write'); renderEditorControls();
}
function renderEditorControls() {
  const entry = state.current;
  const status = entry?.status || 'draft';
  const canEdit = editable();
  $('editor-title').textContent = !entry ? '새 글 작성' : canEdit ? '글 수정' : isAdmin() && status === 'submitted' ? '글 검토' : '글 확인';
  $('editor-eyebrow').textContent = !entry ? 'NEW CONTENT' : status === 'submitted' ? 'CONTENT REVIEW' : 'CONTENT DETAIL';
  $('editor-meta').textContent = entry ? `${entry.author_name || (entry.author_id === state.profile?.id ? '내가 작성한 글' : '구성원이 작성한 글')}${entry.source_path ? ' · 기존 홈페이지 글' : ''}` : '임시 저장 후 언제든 이어서 작성할 수 있습니다.';
  $('editor-status').textContent = statuses[status];
  $('editor-status').className = `status-chip status-${status}`;
  for (const field of $('entry-form').querySelectorAll('input:not([type=file]),textarea,select')) field.disabled = !canEdit || state.busy;
  $('photo-upload').disabled = !canEdit || state.busy || state.assets.length >= 10;
  $('upload-label').hidden = !canEdit;
  $('upload-label').setAttribute('aria-disabled', String(state.busy || state.assets.length >= 10));
  for (const button of $('markdown-toolbar').querySelectorAll('button')) button.disabled = !canEdit || state.busy;
  for (const button of $('photo-list').querySelectorAll('button')) button.disabled = !canEdit || state.busy || button.dataset.edge === 'true';
  $('save-button').hidden = !canEdit;
  $('submit-button').hidden = !canEdit;
  $('approve-button').hidden = !isAdmin() || !['submitted', 'publishing'].includes(status);
  $('approve-button').textContent = status === 'publishing' ? '반영 상태 확인' : '승인하고 반영';
  $('reject-button').hidden = !isAdmin() || status !== 'submitted';
  for (const id of ['save-button', 'submit-button', 'approve-button', 'reject-button']) $(id).disabled = state.busy;
  const notes = {
    submitted: '검토를 요청한 글입니다. 관리자 검토가 끝날 때까지 내용을 수정할 수 없습니다.',
    publishing: '홈페이지 반영을 처리하고 있습니다. 새로고침하면 진행 상태를 확인할 수 있습니다.',
    published: state.demo ? '체험에서 승인을 완료했습니다. 실제 GitHub 커밋이나 홈페이지 반영은 이루어지지 않았습니다.' : '승인되어 홈페이지 반영이 요청되었습니다. 홈페이지에 보이기까지 몇 분 정도 걸릴 수 있습니다.',
    changes_requested: `수정 요청${entry?.feedback ? `: ${entry.feedback}` : '을 받았습니다. 내용을 수정한 뒤 다시 검토를 요청해 주세요.'}`,
  };
  $('entry-note').hidden = !notes[status];
  $('entry-note').textContent = notes[status] || '';
  $('entry-note').className = `note${status === 'changes_requested' ? ' warning' : ''}`;
  const hint = {
    draft: '작성한 내용을 저장한 뒤 검토를 요청하세요. 제출만으로 홈페이지에 공개되지 않습니다.',
    changes_requested: '수정 의견을 반영한 뒤 다시 검토를 요청하세요.',
    submitted: isAdmin() ? '내용을 확인하고 승인하면 홈페이지 반영이 자동으로 요청됩니다.' : '관리자가 내용을 확인하고 있습니다. 결과는 이 화면에서 확인할 수 있습니다.',
    publishing: '승인된 내용을 반영하는 중입니다. 처리가 끝나면 상태가 바뀝니다.',
    published: state.demo ? '체험용 승인입니다. 실제 홈페이지에는 아무것도 게시되지 않았습니다.' : '반영 요청이 완료되었습니다. 홈페이지에서 실제 게시 여부를 확인해 주세요.',
  };
  $('publishing-hint').textContent = hint[status] || '';
  $('progress-steps').replaceChildren();
  const step = ['draft', 'changes_requested'].includes(status) ? 0 : status === 'submitted' ? 1 : 2;
  ['글 작성', '관리자 검토', '홈페이지 반영'].forEach((label, index) => {
    const row = node('div', `progress-step ${index === step ? 'current' : index < step ? 'complete' : ''}`);
    row.append(node('span', '', index < step ? '✓' : String(index + 1)), node('p', '', label));
    $('progress-steps').append(row);
  });
  const commitUrl = safeUrl(entry?.commit_url);
  $('commit-link').hidden = !commitUrl || state.demo;
  if (commitUrl) $('commit-link').href = commitUrl;
  $('refresh-source-button').hidden = !isAdmin() || !entry?.source_path || !['draft', 'changes_requested', 'submitted'].includes(status);
  $('refresh-source-button').disabled = state.busy;
}
function renderPhotos() {
  $('photo-list').replaceChildren();
  $('photo-empty').hidden = state.assets.length > 0;
  const existingImage = state.current?.frontmatter?.image || state.current?.image;
  if (!state.assets.length && existingImage && state.current?.source_path) {
    $('photo-empty').hidden = true;
    const original = node('div', 'legacy-photos');
    const path = String(existingImage).replace(/^\//, '');
    const originalUrl = path.startsWith('images/') && !path.includes('..') ? new URL(`../${path}`, location.href).href : /^data:image\/(png|jpeg|webp);base64,/i.test(existingImage) ? safeUrl(existingImage, true) : '';
    if (originalUrl) {
      const image = node('img'); image.src = originalUrl;
      image.alt = state.current.image_alt || '기존 홈페이지 대표 사진'; image.loading = 'lazy'; original.append(image);
    }
    original.append(node('p', 'field-hint', '기존 홈페이지 사진은 그대로 유지됩니다. 새 사진을 추가하면 기존 사진 구성을 대체합니다.'));
    $('photo-list').append(original);
  }
  state.assets.forEach((asset, index) => {
    const item = node('div', 'photo-item');
    const image = node('img');
    image.alt = asset.alt || asset.name || `첨부 사진 ${index + 1}`;
    const imageUrl = safeUrl(asset.url, true);
    if (imageUrl) image.src = imageUrl;
    image.loading = 'lazy'; item.append(image);
    const fields = node('div', 'photo-fields');
    const info = node('div', 'photo-info');
    info.append(node('span', 'photo-name', asset.name || `사진 ${index + 1}`));
    const controls = node('div', 'photo-controls');
    if (editable()) {
      for (const [action, label, symbol] of [['up', '사진 위로 이동', '↑'], ['down', '사진 아래로 이동', '↓'], ['remove', '사진 삭제', '×']]) {
        const button = node('button', 'icon-button', symbol); button.type = 'button';
        button.setAttribute('aria-label', `${index + 1}번 ${label}`);
        const edge = action === 'up' && index === 0 || action === 'down' && index === state.assets.length - 1;
        button.dataset.edge = String(edge); button.disabled = state.busy || edge;
        button.addEventListener('click', async () => {
          if (action === 'remove') {
            if (await dialog({ title: '사진을 뺄까요?', description: '이 글에서 사진을 제외합니다. 변경 사항은 임시 저장 또는 검토 요청할 때 저장됩니다.', confirm: '사진 빼기' }) === null) return;
            state.assets.splice(index, 1);
          } else {
            const to = action === 'up' ? index - 1 : index + 1;
            [state.assets[index], state.assets[to]] = [state.assets[to], state.assets[index]];
          }
          renderPhotos(); setDirty(); renderEditorControls();
        });
        controls.append(button);
      }
    }
    info.append(controls); fields.append(info);
    for (const [key, labelText, placeholder] of [['caption', '사진 설명', '예: 연구실 세미나에 참여한 구성원들'], ['alt', '이미지 대체 텍스트', '사진이 보이지 않아도 내용을 이해할 수 있도록 적어 주세요']]) {
      const id = `photo-${index}-${key}`;
      const label = node('label', '', labelText); label.htmlFor = id;
      const input = node('input'); input.id = id; input.type = 'text'; input.value = asset[key] || ''; input.placeholder = placeholder; input.maxLength = 500;
      input.disabled = !editable() || state.busy;
      input.addEventListener('input', () => { state.assets[index][key] = input.value; if (key === 'alt') image.alt = input.value || asset.name; setDirty(); });
      fields.append(label, input);
    }
    if (index === 0) fields.append(node('span', 'representative', '대표 사진'));
    item.append(fields); $('photo-list').append(item);
  });
}
function setTab(tab) {
  const preview = tab === 'preview';
  $('write-tab').setAttribute('aria-selected', String(!preview));
  $('preview-tab').setAttribute('aria-selected', String(preview));
  $('write-tab').tabIndex = preview ? -1 : 0;
  $('preview-tab').tabIndex = preview ? 0 : -1;
  $('write-panel').hidden = preview; $('preview-panel').hidden = !preview;
  if (preview) renderPreview();
}
function inlineText(parent, source) {
  const expression = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^\s)]+)\))/g;
  let offset = 0;
  for (const match of source.matchAll(expression)) {
    parent.append(document.createTextNode(source.slice(offset, match.index)));
    if (match[2]) parent.append(node('strong', '', match[2]));
    else if (match[3]) parent.append(node('em', '', match[3]));
    else {
      const href = safeUrl(match[5]);
      if (href) { const anchor = node('a', '', match[4]); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; parent.append(anchor); }
      else parent.append(document.createTextNode(match[4]));
    }
    offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(source.slice(offset)));
}
function renderPreview() {
  const container = $('preview-panel'); container.replaceChildren();
  const body = $('entry-body').value;
  if (!body.trim()) { container.append(node('p', 'muted', '작성한 본문이 여기에 표시됩니다.')); return; }
  const lines = body.split('\n'); let paragraph = [], list = null, code = null;
  const flush = () => { if (paragraph.length) { const p = node('p'); inlineText(p, paragraph.join('\n')); container.append(p); paragraph = []; } list = null; };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (code) { container.append(node('pre', '', code.join('\n'))); code = null; }
      else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (heading) { flush(); const h = node(`h${heading[1].length}`); inlineText(h, heading[2]); container.append(h); }
    else if (bullet) { if (paragraph.length) flush(); if (!list) { list = node('ul'); container.append(list); } const li = node('li'); inlineText(li, bullet[1]); list.append(li); }
    else if (/^>\s?/.test(line)) { flush(); const quote = node('blockquote'); inlineText(quote, line.replace(/^>\s?/, '')); container.append(quote); }
    else if (!line.trim()) flush();
    else { if (list) list = null; paragraph.push(line); }
  }
  flush(); if (code) container.append(node('pre', '', code.join('\n')));
}
async function uploadPhotos(files) {
  if (state.busy || !editable() || !files.length) return;
  if (state.assets.length + files.length > 10) { feedback('workspace-feedback', '사진은 최대 10장까지 추가할 수 있습니다.', true); return; }
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { feedback('workspace-feedback', `${file.name}: JPG, PNG, WebP 사진을 선택해 주세요.`, true); return; }
    if (file.size > 5 * 1024 * 1024) { feedback('workspace-feedback', `${file.name}: 사진은 장당 5 MB 이하여야 합니다.`, true); return; }
  }
  if (!validForm()) { feedback('workspace-feedback', '사진을 추가하기 전에 필수 정보를 입력해 주세요.', true); return; }
  setBusy(true); feedback('workspace-feedback', '');
  let uploaded = 0;
  try {
    if (!state.current || state.dirty) { if (!(await saveDraft())) return; }
    for (const file of files) {
      $('upload-status').textContent = `${uploaded + 1}/${files.length} · ${file.name} 업로드 중…`;
      const base64 = await readFile(file);
      const response = await state.client.request('upload', { id: state.current.id, version: state.current.version, name: file.name, mime: file.type, base64 });
      mergeEntry(response.entry);
      if (!state.assets.some((asset) => asset.path === response.asset.path)) state.assets.push(response.asset);
      else state.assets = state.assets.map((asset) => asset.path === response.asset.path ? { ...asset, ...response.asset } : asset);
      uploaded += 1; markClean(); renderPhotos();
    }
    $('upload-status').textContent = `${uploaded}장의 사진을 추가하고 저장했습니다.`;
    feedback('workspace-feedback', state.demo ? '체험용 사진을 추가했습니다. 실제 홈페이지에는 반영되지 않습니다.' : '사진을 추가했습니다. 설명과 대체 텍스트도 적어 주세요.');
  } catch (error) {
    $('upload-status').textContent = uploaded ? `${uploaded}장은 저장되었습니다. 나머지 사진은 다시 추가해 주세요.` : '사진을 추가하지 못했습니다.';
    feedback('workspace-feedback', errorText(error), true);
  } finally { setBusy(false); renderPhotos(); $('photo-upload').value = ''; }
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다. 다시 선택해 주세요.'));
    reader.readAsDataURL(file);
  });
}
async function submitEntry() {
  if (state.busy || !editable() || !validForm()) return;
  const answer = await dialog({ title: '검토를 요청할까요?', description: '작성한 글과 사진을 저장하고 관리자에게 제출합니다. 검토 중에는 글을 수정할 수 없습니다.', confirm: '검토 요청' });
  if (answer === null) return;
  setBusy(true);
  try {
    if (!state.current || state.dirty) { if (!(await saveDraft())) return; }
    const result = await state.client.request('submit', { id: state.current.id, version: state.current.version });
    mergeEntry(result.entry); markClean(); renderPhotos(); renderNavigation();
    feedback('workspace-feedback', state.demo ? '체험용 검토 요청을 제출했습니다. 관리자 역할로 바꾸어 검토해 보세요.' : '검토 요청을 제출했습니다. 관리자가 확인하면 상태가 바뀝니다.');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
async function reviewEntry(action) {
  if (state.busy || !isAdmin() || !['submitted', 'publishing'].includes(state.current?.status)) return;
  const approving = action === 'approve';
  const reconciling = approving && state.current.status === 'publishing';
  if (!approving && state.current.status !== 'submitted') return;
  const answer = await dialog(reconciling ? {
    title: '반영 상태를 확인할까요?', description: '진행 중인 반영 요청이 완료되었는지 확인합니다. 결과가 확인되지 않으면 잠시 후 다시 확인해 주세요.', confirm: '상태 확인',
  } : approving ? {
    title: '승인하고 반영할까요?', description: state.demo ? '체험용으로 승인 흐름을 진행합니다. 실제 GitHub 커밋이나 홈페이지 반영은 이루어지지 않습니다.' : '글과 사진을 홈페이지에 반영하도록 요청합니다. 승인 후 실제 홈페이지에 보이기까지 몇 분 정도 걸릴 수 있습니다.', confirm: '승인하고 반영',
  } : {
    title: '수정 의견을 보내세요', description: '작성자가 내용을 수정하고 다시 제출할 수 있도록 필요한 변경 사항을 적어 주세요.', confirm: '수정 요청 보내기', fields: [{ name: 'feedback', label: '수정 의견', type: 'textarea', maxLength: 2000, placeholder: '예: 행사 날짜를 본문에 추가해 주세요.' }],
  });
  if (answer === null) return;
  setBusy(true);
  try {
    const result = await state.client.request(action, { id: state.current.id, version: state.current.version, ...(!approving ? { feedback: answer.feedback.trim() } : {}) });
    mergeEntry(result.entry); markClean(); renderPhotos(); renderNavigation();
    if (approving) {
      feedback('workspace-feedback', state.demo || result.deployment === 'demo' ? '체험에서 승인을 완료했습니다. 실제 GitHub 커밋이나 홈페이지 반영은 이루어지지 않았습니다.' : result.entry.status === 'publishing' ? '반영 요청의 완료가 아직 확인되지 않았습니다. 잠시 후 반영 상태를 다시 확인해 주세요.' : result.commitCreated ? '승인되었습니다. 홈페이지 반영을 요청했으며 게시까지 몇 분 정도 걸릴 수 있습니다.' : '반영 상태를 확인했습니다. 홈페이지에서 실제 게시 여부를 확인해 주세요.');
    } else feedback('workspace-feedback', '수정 의견을 전달했습니다. 작성자가 글을 수정해 다시 제출할 수 있습니다.');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
async function showCatalog() {
  if (!isAdmin() || !(await confirmLeave())) return;
  setBusy(true); $('catalog-list').replaceChildren(node('p', 'load-state', '기존 글을 불러오고 있습니다…'));
  showContent('catalog-view'); focusHeading('catalog-title');
  try {
    const result = await state.client.request('catalog'); state.catalog = (result.files || []).filter((file) => file.collection === 'blog' && isBlogPath(file.path)); renderCatalog();
  } catch (error) { feedback('workspace-feedback', errorText(error), true); $('catalog-list').replaceChildren(node('p', 'load-state', '글을 불러오지 못했습니다. 다시 시도해 주세요.')); }
  finally { setBusy(false); }
}
function renderCatalog() {
  $('catalog-list').replaceChildren();
  const query = state.catalogSearch.toLocaleLowerCase();
  const files = state.catalog.filter((file) => !query || `${file.title} ${file.description || ''} ${file.body || ''}`.toLocaleLowerCase().includes(query));
  $('catalog-count').textContent = `${files.length}개의 글`;
  if (!files.length) { const empty = node('div', 'empty-state'); empty.append(node('h2', '', '조건에 맞는 블로그 글이 없습니다.'), node('p', '', '검색어를 바꿔 보세요.')); $('catalog-list').append(empty); }
  for (const file of files) {
    const row = node('div', 'entry-card catalog-row');
    const info = node('div', 'entry-info'); const line = node('div', 'entry-topline');
    line.append(node('span', 'muted', file.date || '')); info.append(line, node('h3', '', file.title || '제목 없는 글'));
    if (file.description) info.append(node('p', 'entry-description', file.description));
    const button = node('button', 'button secondary small', '가져와서 수정'); button.type = 'button';
    button.addEventListener('click', () => importEntry(file.path)); row.append(info, button); $('catalog-list').append(row);
  }
}
async function importEntry(path) {
  if (state.busy) return;
  if (!isBlogPath(path)) { feedback('workspace-feedback', '블로그 글을 확인할 수 없습니다.', true); return; }
  setBusy(true);
  try {
    const result = await state.client.request('import', { path });
    mergeEntry(result.entry); state.assets = result.entry.assets || [];
    const assets = await state.client.request('assets', { id: result.entry.id }); state.assets = assets.assets || state.assets;
    populateEditor(result.entry); showContent('editor-view'); renderPhotos(); markClean(); renderNavigation();
    feedback('workspace-feedback', '기존 블로그 글을 가져왔습니다. 수정한 뒤 검토를 요청해 주세요.'); focusHeading('editor-title');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
async function refreshSource() {
  const entry = state.current;
  if (state.busy || !isAdmin() || !entry?.source_path || !['draft', 'changes_requested', 'submitted'].includes(entry.status)) return;
  const answer = await dialog({
    title: '홈페이지의 최신 글을 가져올까요?',
    description: '현재 작성·제출한 글 내용을 홈페이지에 있는 최신 내용으로 대체합니다. 새로 첨부한 사진은 유지되며, 글은 작성 중 상태가 됩니다.',
    confirm: '최신 내용으로 대체',
  });
  if (answer === null) return;
  setBusy(true);
  try {
    const result = await state.client.request('import', { path: entry.source_path, refresh: true, id: entry.id, version: entry.version });
    mergeEntry(result.entry); state.assets = result.entry.assets || [];
    const resultAssets = await state.client.request('assets', { id: result.entry.id }); state.assets = resultAssets.assets || state.assets;
    populateEditor(result.entry); renderPhotos(); markClean(); renderNavigation();
    feedback('workspace-feedback', '홈페이지의 최신 내용을 가져왔습니다. 필요한 내용을 수정하고 다시 검토를 요청해 주세요.');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
async function signOut() {
  if (!(await confirmLeave())) return;
  setBusy(true);
  try {
    await state.client?.signOut();
    state.profile = null; state.entries = []; state.current = null; state.dirty = false; state.demo = false;
    const url = new URL(location.href); url.searchParams.delete('demo'); history.replaceState(null, '', `${url.pathname}${url.search}`);
    state.client = configured() ? createClient(window.CMS_CONFIG) : null;
    showView('auth-view'); feedback('auth-feedback', '로그아웃했습니다.');
  } catch (error) { feedback('workspace-feedback', errorText(error), true); }
  finally { setBusy(false); }
}
function bindEvents() {
  $('demo-button').addEventListener('click', startDemo);
  $('new-entry').addEventListener('click', newEntry);
  $('signout').addEventListener('click', signOut);
  $('catalog-button').addEventListener('click', showCatalog);
  $('refresh-source-button').addEventListener('click', refreshSource);
  for (const id of ['back-button', 'catalog-back']) $(id).addEventListener('click', async () => { if (await confirmLeave()) { state.dirty = false; showContent('list-view'); renderList(); focusHeading('list-title'); } });
  $('review-summary-button').addEventListener('click', () => { state.filter = 'submitted'; renderList(); });
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', async () => {
    if (!(await confirmLeave())) return;
    state.filter = button.dataset.filter; state.dirty = false; showContent('list-view'); renderList();
  });
  $('search-input').addEventListener('input', (event) => { state.search = event.target.value; renderList(); });
  $('catalog-search').addEventListener('input', (event) => { state.catalogSearch = event.target.value; renderCatalog(); });
  $('refresh-button').addEventListener('click', async () => {
    if (state.busy) return; setBusy(true);
    try { await loadData(); feedback('workspace-feedback', '최신 상태로 갱신했습니다.'); }
    catch (error) { feedback('workspace-feedback', errorText(error), true); }
    finally { setBusy(false); }
  });
  $('demo-role').addEventListener('change', async (event) => {
    const role = event.target.value;
    if (!(await confirmLeave())) { $('demo-role').value = state.profile.role; return; }
    setBusy(true);
    try { await state.client.setRole(role); await loadData(); state.current = null; state.dirty = false; state.filter = 'all'; showContent('list-view'); renderList(); feedback('workspace-feedback', `체험 역할을 ${role === 'admin' ? '관리자' : '구성원'}로 바꿨습니다.`); }
    catch (error) { feedback('workspace-feedback', errorText(error), true); }
    finally { setBusy(false); }
  });
  $('entry-form').addEventListener('input', (event) => {
    if (event.target.id === 'entry-title') event.target.setCustomValidity('');
    setDirty();
  });
  $('entry-form').addEventListener('change', setDirty);
  $('entry-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (state.busy || !editable() || !validForm()) return; setBusy(true);
    try { if (await saveDraft()) feedback('workspace-feedback', state.demo ? '체험용 글을 저장했습니다. 실제 홈페이지에는 반영되지 않습니다.' : '임시 저장했습니다. 준비가 되면 검토를 요청해 주세요.'); }
    catch (error) { feedback('workspace-feedback', errorText(error), true); }
    finally { setBusy(false); }
  });
  $('submit-button').addEventListener('click', submitEntry);
  $('approve-button').addEventListener('click', () => reviewEntry('approve'));
  $('reject-button').addEventListener('click', () => reviewEntry('reject'));
  $('photo-upload').addEventListener('change', (event) => { const files = [...event.target.files]; event.target.value = ''; uploadPhotos(files); });
  $('write-tab').addEventListener('click', () => setTab('write'));
  $('preview-tab').addEventListener('click', () => setTab('preview'));
  for (const tab of [$('write-tab'), $('preview-tab')]) tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const preview = event.key === 'End' || (event.key !== 'Home' && tab.id === 'write-tab'); setTab(preview ? 'preview' : 'write'); $(preview ? 'preview-tab' : 'write-tab').focus();
  });
  for (const button of $('markdown-toolbar').querySelectorAll('button')) button.addEventListener('click', async () => {
    const area = $('entry-body'); if (!editable() || state.busy) return;
    const start = area.selectionStart, end = area.selectionEnd, selected = area.value.slice(start, end);
    let value = '';
    switch (button.dataset.format) {
      case 'bold': value = `**${selected || '강조할 내용'}**`; break;
      case 'italic': value = `*${selected || '강조할 내용'}*`; break;
      case 'heading': value = `${start && area.value[start - 1] !== '\n' ? '\n' : ''}## ${selected || '소제목'}`; break;
      case 'list': value = `${start && area.value[start - 1] !== '\n' ? '\n' : ''}- ${selected || '목록 항목'}`; break;
      case 'link': {
        const answer = await dialog({ title: '링크 추가', description: '연결할 페이지 주소를 입력하세요.', confirm: '추가', fields: [{ name: 'text', label: '표시할 글자', value: selected || '' }, { name: 'url', label: '페이지 주소', type: 'url', placeholder: 'https://example.com' }] });
        if (answer === null) return; if (!safeUrl(answer.url)) { feedback('workspace-feedback', 'http 또는 https 주소를 입력해 주세요.', true); return; }
        value = `[${answer.text.replaceAll(']', '')}](${answer.url})`; break;
      }
    }
    area.setRangeText(value, start, end, 'select'); area.focus(); setDirty();
  });
  $('dialog-close').addEventListener('click', () => finishDialog(null));
  $('dialog-cancel').addEventListener('click', () => finishDialog(null));
  $('action-dialog').addEventListener('cancel', (event) => { event.preventDefault(); finishDialog(null); });
  $('dialog-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData($('dialog-form')));
    for (const input of $('dialog-fields').querySelectorAll('input,textarea')) {
      if (input.required && !input.value.trim()) { feedback('dialog-feedback', '내용을 입력해 주세요.', true); input.focus(); return; }
    }
    finishDialog(values);
  });
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!state.client || !configured()) return;
    $('login-button').disabled = true; $('login-button').textContent = '로그인 중…'; feedback('auth-feedback', '');
    try {
      await state.client.signIn($('login-email').value.trim(), $('login-password').value);
      await loadData(); $('login-password').value = ''; showView('workspace'); showContent('list-view'); focusHeading('list-title');
    } catch (error) { feedback('auth-feedback', errorText(error), true); }
    finally { $('login-button').disabled = false; $('login-button').textContent = '로그인'; }
  });
  $('recovery-button').addEventListener('click', async () => {
    if (!state.client || !configured()) return;
    const login = $('login-email').value.trim();
    const registeredEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) ? login : '';
    const answer = await dialog({ title: '비밀번호 재설정', description: '계정에 등록된 실제 이메일 주소를 입력하세요. 공용 계정의 이메일을 모르면 운영자에게 문의해 주세요.', confirm: '안내 보내기', fields: [{ name: 'email', label: '등록된 이메일', type: 'email', value: registeredEmail, autocomplete: 'email' }] });
    if (answer === null) return; $('recovery-button').disabled = true;
    try { await state.client.recoverPassword(answer.email.trim()); feedback('auth-feedback', '등록된 이메일이라면 비밀번호 재설정 안내를 받을 수 있습니다. 메일함을 확인해 주세요.'); }
    catch (error) { feedback('auth-feedback', errorText(error), true); }
    finally { $('recovery-button').disabled = false; }
  });
  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!state.client) return;
    const password = $('new-password').value;
    if (password !== $('confirm-password').value) { feedback('password-feedback', '두 비밀번호가 일치하지 않습니다.', true); $('confirm-password').focus(); return; }
    const button = $('password-form').querySelector('button'); button.disabled = true;
    try { await state.client.setPassword(password); await loadData(); $('new-password').value = ''; $('confirm-password').value = ''; showView('workspace'); showContent('list-view'); feedback('workspace-feedback', '비밀번호를 저장했습니다. 연구실 소식을 작성해 보세요.'); }
    catch (error) { feedback('password-feedback', errorText(error), true); }
    finally { button.disabled = false; }
  });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
}
async function initialize() {
  bindEvents(); $('entry-date').max = koreanToday();
  if (new URLSearchParams(location.search).get('demo') === '1') { await startDemo(); return; }
  if (!configured()) {
    $('connection-note').hidden = false;
    $('connection-note').textContent = '관리 화면 연결을 준비 중입니다. 지금은 로그인할 수 없으며, 아래에서 작성·검토 화면을 체험할 수 있습니다.';
    for (const element of $('login-form').elements) element.disabled = true;
    $('recovery-button').hidden = true;
    return;
  }
  try {
    state.client = createClient(window.CMS_CONFIG);
    const session = await state.client.getSession();
    if (state.client.isPasswordFlow?.()) {
      if (!session) throw new Error('초대 또는 재설정 링크가 만료되었습니다. 관리자에게 새 초대를 요청하거나 비밀번호 재설정을 다시 진행해 주세요.');
      showView('password-view'); $('new-password').focus(); return;
    }
    if (session) { await loadData(); showView('workspace'); showContent('list-view'); }
  } catch (error) { feedback('auth-feedback', errorText(error), true); }
}
initialize();
