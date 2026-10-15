const STORAGE_KEY = 'dambyeorak.posts.v1';
const state = { posts: loadPosts(), selectedId: null, deleteId: null };

const $ = (selector) => document.querySelector(selector);
const postList = $('#postList');
const detailPanel = $('#detailPanel');
const postDialog = $('#postDialog');
const confirmDialog = $('#confirmDialog');
const postForm = $('#postForm');

function loadPosts() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

function savePosts() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.posts)); }
function escapeHtml(value = '') { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatDate(iso) { return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'long', day:'numeric' }).format(new Date(iso)); }

function render() {
  $('#postCount').textContent = `${state.posts.length}개의 글`;
  if (!state.posts.length) {
    postList.innerHTML = '<div class="empty-list">아직 붙여둔 이야기가 없어요.</div>';
    detailPanel.innerHTML = `<div class="empty-state"><div><span class="empty-icon">✎</span><h2>첫 이야기를 남겨보세요</h2><p>오른쪽 위 ‘새 글 쓰기’를 누르면 시작할 수 있어요.</p></div></div>`;
    return;
  }
  if (!state.posts.some(post => post.id === state.selectedId)) state.selectedId = state.posts[0].id;
  postList.innerHTML = state.posts.map(post => `<button class="post-item ${post.id === state.selectedId ? 'active' : ''}" data-id="${post.id}" type="button"><h3>${escapeHtml(post.title)}</h3><div class="post-meta"><span>${escapeHtml(post.author)}</span><span>${formatDate(post.updatedAt)}</span></div></button>`).join('');
  const post = state.posts.find(item => item.id === state.selectedId);
  detailPanel.innerHTML = `<span class="detail-label">POST DETAIL</span><h2>${escapeHtml(post.title)}</h2><div class="detail-meta"><strong>${escapeHtml(post.author)}</strong><span>${formatDate(post.updatedAt)}${post.createdAt !== post.updatedAt ? ' · 수정됨' : ''}</span></div><div class="detail-content">${escapeHtml(post.content)}</div><div class="detail-actions"><button class="text-button" data-action="edit" type="button">수정</button><button class="text-button delete-button" data-action="delete" type="button">삭제</button></div>`;
}

function openForm(post = null) {
  postForm.reset();
  $('#postId').value = post?.id || '';
  $('#dialogTitle').textContent = post ? '글 수정하기' : '새 글 쓰기';
  if (post) { $('#titleInput').value = post.title; $('#authorInput').value = post.author; $('#contentInput').value = post.content; }
  postDialog.showModal();
  setTimeout(() => $('#titleInput').focus(), 50);
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

$('#newPostButton').addEventListener('click', () => openForm());
$('#closeDialogButton').addEventListener('click', () => postDialog.close());
$('#cancelButton').addEventListener('click', () => postDialog.close());
postDialog.addEventListener('click', event => { if (event.target === postDialog) postDialog.close(); });

postForm.addEventListener('submit', event => {
  event.preventDefault();
  const id = $('#postId').value;
  const now = new Date().toISOString();
  const values = { title: $('#titleInput').value.trim(), author: $('#authorInput').value.trim(), content: $('#contentInput').value.trim() };
  if (!values.title || !values.author || !values.content) return;
  if (id) {
    const index = state.posts.findIndex(post => post.id === id);
    state.posts[index] = { ...state.posts[index], ...values, updatedAt: now };
    showToast('글을 수정했어요.');
  } else {
    const post = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, ...values, createdAt: now, updatedAt: now };
    state.posts.unshift(post); state.selectedId = post.id;
    showToast('새 글을 붙였어요.');
  }
  savePosts(); render(); postDialog.close();
});

postList.addEventListener('click', event => {
  const item = event.target.closest('[data-id]');
  if (!item) return; state.selectedId = item.dataset.id; render();
  if (window.innerWidth < 801) detailPanel.scrollIntoView({ behavior:'smooth', block:'start' });
});

detailPanel.addEventListener('click', event => {
  const action = event.target.dataset.action;
  const post = state.posts.find(item => item.id === state.selectedId);
  if (action === 'edit') openForm(post);
  if (action === 'delete') { state.deleteId = post.id; confirmDialog.showModal(); }
});

confirmDialog.addEventListener('close', () => {
  if (confirmDialog.returnValue !== 'confirm') return;
  state.posts = state.posts.filter(post => post.id !== state.deleteId);
  state.selectedId = state.posts[0]?.id || null; state.deleteId = null;
  savePosts(); render(); showToast('글을 삭제했어요.');
});

render();
