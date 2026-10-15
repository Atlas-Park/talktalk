const API_URL = '/api/posts';
const STORAGE_KEY = 'dambyeorak.posts.v1';
const BACKUP_KEY = 'dambyeorak.posts.v1.backup';
const MIGRATED_KEY = 'dambyeorak.posts.v1.migrated';
function apiFetch(url, options = {}) {
  return fetch(url, options);
}

async function responseError(response, fallback) {
  try {
    const data = await response.json();
    return new Error(data.message || fallback);
  } catch {
    return new Error(fallback);
  }
}

const state = {
  posts: [],
  selectedId: null,
  deleteId: null,
  searchQuery: '',
  comments: []
};

const $ = (selector) => document.querySelector(selector);
const postList = $('#postList');
const detailPanel = $('#detailPanel');
const postDialog = $('#postDialog');
const confirmDialog = $('#confirmDialog');
const postForm = $('#postForm');
const searchInput = $('#searchInput');
const clearSearchButton = $('#clearSearchButton');

function escapeHtml(value = '') {
  return String(value || '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

const escapeAttribute = escapeHtml;

function formatDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(iso));
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));
}

// 1. 기존 localStorage 데이터 안전 백업 및 마이그레이션
async function backupAndMigrateLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    localStorage.setItem(BACKUP_KEY, raw);
    const localPosts = JSON.parse(raw);
    if (!Array.isArray(localPosts) || localPosts.length === 0) return;

    if (localStorage.getItem(MIGRATED_KEY)) return;

    // 원격 마이그레이션은 운영자 토큰이 필요한 관리 작업으로 분리한다.
    // 브라우저에서는 원본을 별도 키에 보존해 데이터 유실만 방지한다.
    localStorage.setItem(MIGRATED_KEY, 'pending-admin-migration');
  } catch (error) {
    console.warn('localStorage 데이터 백업 중 오류:', error);
  }
}

// 2. 게시글 목록 요청 (검색, 최신순 정렬, 댓글 개수 포함)
async function fetchPosts(keepSelection = true) {
  const requestId = ++fetchPosts.requestId;
  const requestedQuery = state.searchQuery;
  try {
    const url = requestedQuery
      ? `${API_URL}?q=${encodeURIComponent(requestedQuery)}`
      : API_URL;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('서버 응답 오류');
    const posts = await response.json();
    if (requestId !== fetchPosts.requestId || requestedQuery !== state.searchQuery) return;
    state.posts = posts;
    renderList();

    if (state.posts.length > 0) {
      if (!keepSelection || !state.posts.some(p => p.id === state.selectedId)) {
        state.selectedId = state.posts[0].id;
      }
      await fetchComments(state.selectedId);
    } else {
      state.selectedId = null;
      state.comments = [];
      renderDetail();
    }
  } catch (error) {
    console.error('게시글 목록 로드 오류:', error);
    showToast('게시글 목록을 불러오지 못했습니다.');
    renderList();
    renderDetail();
  }
}
fetchPosts.requestId = 0;

// 3. 특정 게시글의 댓글 목록 조회
async function fetchComments(postId) {
  const requestId = ++fetchComments.requestId;
  if (!postId) {
    state.comments = [];
    renderDetail();
    return;
  }
  try {
    const res = await apiFetch(`${API_URL}/${encodeURIComponent(postId)}/comments`);
    if (res.ok) {
      const comments = await res.json();
      if (requestId !== fetchComments.requestId || postId !== state.selectedId) return;
      state.comments = comments;
    } else {
      state.comments = [];
    }
  } catch (err) {
    console.error('댓글 조회 오류:', err);
    state.comments = [];
  }
  renderDetail();
}
fetchComments.requestId = 0;

function renderList() {
  const countText = state.searchQuery
    ? `검색 결과 ${state.posts.length}개`
    : `${state.posts.length}개의 글`;
  $('#postCount').textContent = countText;

  if (!state.posts.length) {
    postList.innerHTML = state.searchQuery
      ? '<div class="empty-list">검색 조건과 일치하는 글이 없어요.</div>'
      : '<div class="empty-list">아직 붙여둔 이야기가 없어요.</div>';
    return;
  }

  postList.innerHTML = state.posts.map(post => {
    const commentBadgeHtml = Number(post.commentCount) > 0
      ? `<span class="comment-badge" title="댓글 ${post.commentCount}개">💬 ${post.commentCount}</span>`
      : '';

    return `
      <button class="post-item ${post.id === state.selectedId ? 'active' : ''}" data-id="${escapeAttribute(post.id)}" type="button">
        <h3>${escapeHtml(post.title)}</h3>
        <div class="post-meta">
          <span>${escapeHtml(post.author)}</span>
          <span>${formatDate(post.createdAt || post.updatedAt)}</span>
          ${commentBadgeHtml}
        </div>
      </button>
    `;
  }).join('');
}

function renderDetail() {
  if (!state.posts.length || !state.selectedId) {
    detailPanel.innerHTML = `
      <div class="empty-state">
        <div>
          <span class="empty-icon">✎</span>
          <h2>첫 이야기를 남겨보세요</h2>
          <p>오른쪽 위 ‘새 글 쓰기’를 누르면 시작할 수 있어요.</p>
        </div>
      </div>
    `;
    return;
  }

  const post = state.posts.find(item => item.id === state.selectedId);
  if (!post) return;

  const commentsHtml = state.comments.length === 0
    ? '<div class="comment-empty">아직 작성된 댓글이 없어요. 첫 번째 이야기를 남겨보세요!</div>'
    : state.comments.map(c => `
        <div class="comment-item" data-comment-id="${escapeAttribute(c.id)}">
          <div class="comment-top">
            <div>
              <span class="comment-author">${escapeHtml(c.author)}</span>
              <span class="comment-date">${formatDateTime(c.createdAt)}</span>
            </div>
            <button class="comment-delete-btn" type="button" data-action="delete-comment" data-id="${escapeAttribute(c.id)}" aria-label="댓글 삭제">삭제</button>
          </div>
          <div class="comment-body">${escapeHtml(c.content)}</div>
        </div>
      `).join('');

  detailPanel.innerHTML = `
    <span class="detail-label">POST DETAIL</span>
    <h2>${escapeHtml(post.title)}</h2>
    <div class="detail-meta">
      <strong>${escapeHtml(post.author)}</strong>
      <span>${formatDate(post.createdAt)}${post.createdAt !== post.updatedAt ? ' · 수정됨' : ''}</span>
      <span>댓글 ${state.comments.length}개</span>
    </div>
    <div class="detail-content">${escapeHtml(post.content)}</div>
    <div class="detail-actions">
      <button class="text-button" data-action="edit" type="button">수정</button>
      <button class="text-button delete-button" data-action="delete" type="button">삭제</button>
    </div>

    <section class="comments-section" aria-label="댓글 영역">
      <div class="comments-header">
        <div><span class="section-number">02</span><h3>댓글</h3></div>
        <span class="comments-count">${state.comments.length}개의 댓글</span>
      </div>
      <div class="comments-list" id="commentsList">
        ${commentsHtml}
      </div>
      <form class="comment-form" id="commentForm">
        <div class="comment-form-heading">
          <span class="eyebrow">LEAVE A NOTE</span>
          <span>댓글 남기기</span>
        </div>
        <div class="comment-form-author">
          <input type="text" id="commentAuthorInput" placeholder="이름을 입력해 주세요" maxlength="20" required>
          <input type="password" id="commentPasswordInput" placeholder="비밀번호 (4자 이상)" minlength="4" maxlength="64" autocomplete="new-password" required>
        </div>
        <div class="comment-form-content">
          <textarea id="commentContentInput" placeholder="따뜻한 이야기를 남겨주세요." rows="3" maxlength="500" required></textarea>
        </div>
        <div class="comment-form-bottom">
          <button type="submit" class="comment-submit-btn">댓글 등록</button>
        </div>
      </form>
    </section>
  `;
}

function openForm(post = null) {
  postForm.reset();
  $('#postId').value = post?.id || '';
  $('#dialogTitle').textContent = post ? '글 수정하기' : '새 글 쓰기';
  if (post) {
    $('#titleInput').value = post.title;
    $('#authorInput').value = post.author;
    $('#contentInput').value = post.content;
  }
  $('#passwordInput').value = '';
  postDialog.showModal();
  setTimeout(() => $('#titleInput').focus(), 50);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// 검색 이벤트 리스너 (디바운스 적용)
let searchTimer = null;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const value = searchInput.value.trim();
    state.searchQuery = value;
    if (clearSearchButton) {
      clearSearchButton.style.display = searchInput.value ? 'block' : 'none';
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      fetchPosts(false);
    }, 250);
  });
}

if (clearSearchButton) {
  clearSearchButton.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchButton.style.display = 'none';
    fetchPosts(false);
  });
}

$('#newPostButton').addEventListener('click', () => openForm());
$('#closeDialogButton').addEventListener('click', () => postDialog.close());
$('#cancelButton').addEventListener('click', () => postDialog.close());
postDialog.addEventListener('click', event => { if (event.target === postDialog) postDialog.close(); });

// 글 저장 (POST 또는 PUT 요청)
postForm.addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#postId').value;
  const values = {
    title: $('#titleInput').value.trim(),
    author: $('#authorInput').value.trim(),
    content: $('#contentInput').value.trim(),
    password: $('#passwordInput').value
  };
  if (!values.title || !values.author || !values.content || values.password.length < 4) return;

  try {
    if (id) {
      const response = await apiFetch(`${API_URL}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      if (!response.ok) throw await responseError(response, '글 수정 실패');
      showToast('글을 수정했어요.');
      await fetchPosts(true);
    } else {
      const response = await apiFetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      if (!response.ok) throw await responseError(response, '글 작성 실패');
      const created = await response.json();
      state.selectedId = created.id;
      showToast('새 글을 붙였어요.');
      await fetchPosts(true);
    }
    postDialog.close();
  } catch (error) {
    console.error('게시글 저장 오류:', error);
    showToast(error.message || '게시글 저장에 실패했습니다.');
  }
});

// 게시글 목록 클릭 (상세 조회 전환)
postList.addEventListener('click', async event => {
  const item = event.target.closest('[data-id]');
  if (!item) return;
  state.selectedId = item.dataset.id;
  renderList();
  await fetchComments(state.selectedId);
  if (window.innerWidth < 801) detailPanel.scrollIntoView({ behavior:'smooth', block:'start' });
});

// 상세 패널 클릭 (게시글 수정, 삭제 및 댓글 삭제 이벤트 위임)
detailPanel.addEventListener('click', async event => {
  const target = event.target;
  const action = target.dataset.action;
  const post = state.posts.find(item => item.id === state.selectedId);

  // 게시글 수정
  if (action === 'edit' && post) {
    openForm(post);
  }

  // 게시글 삭제 다이얼로그 호출
  if (action === 'delete' && post) {
    state.deleteId = post.id;
    $('#deletePasswordInput').value = '';
    confirmDialog.showModal();
  }

  // 댓글 삭제
  if (action === 'delete-comment') {
    const commentId = target.dataset.id;
    if (!commentId) return;

    const password = prompt('댓글 작성 때 입력한 비밀번호를 입력해 주세요.');
    if (password === null) return;

    try {
      const res = await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw await responseError(res, '댓글 삭제 실패');
      showToast('댓글을 삭제했어요.');
      await fetchComments(state.selectedId);
      // 게시글 목록의 댓글 카운트 갱신
      const postIdx = state.posts.findIndex(p => p.id === state.selectedId);
      if (postIdx !== -1) {
        state.posts[postIdx].commentCount = Math.max(0, (state.posts[postIdx].commentCount || 1) - 1);
        renderList();
      }
    } catch (err) {
      console.error('댓글 삭제 오류:', err);
      showToast(err.message || '댓글 삭제에 실패했습니다.');
    }
  }
});

// 상세 패널 폼 제출 (댓글 작성 이벤트 위임)
detailPanel.addEventListener('submit', async event => {
  if (event.target.id !== 'commentForm') return;
  event.preventDefault();

  const authorInput = $('#commentAuthorInput');
  const contentInput = $('#commentContentInput');
  const passwordInput = $('#commentPasswordInput');
  if (!authorInput || !contentInput || !passwordInput) return;

  const author = authorInput.value.trim();
  const content = contentInput.value.trim();
  const password = passwordInput.value;
  if (!author || !content || password.length < 4 || !state.selectedId) return;

  try {
    const targetPostId = state.selectedId;
    const res = await apiFetch(`${API_URL}/${encodeURIComponent(targetPostId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, content, password })
    });
    if (!res.ok) throw await responseError(res, '댓글 등록 실패');

    contentInput.value = '';
    passwordInput.value = '';
    showToast('댓글을 남겼어요.');
    await fetchComments(targetPostId);

    // 게시글 목록의 댓글 카운트 갱신
    const postIdx = state.posts.findIndex(p => p.id === state.selectedId);
    if (postIdx !== -1) {
      state.posts[postIdx].commentCount = (Number(state.posts[postIdx].commentCount) || 0) + 1;
      renderList();
    }
  } catch (err) {
    console.error('댓글 작성 오류:', err);
    showToast(err.message || '댓글 등록에 실패했습니다.');
  }
});

// 글 삭제 완료 처리 (서버로 DELETE 요청)
confirmDialog.addEventListener('close', async () => {
  if (confirmDialog.returnValue !== 'confirm' || !state.deleteId) return;

  const targetId = state.deleteId;
  const password = $('#deletePasswordInput').value;
  if (password.length < 4) {
    state.deleteId = null;
    showToast('비밀번호를 입력해 주세요.');
    return;
  }
  state.deleteId = null;

  try {
    const response = await apiFetch(`${API_URL}/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) throw await responseError(response, '글 삭제 실패');

    state.selectedId = null;
    showToast('글과 모든 댓글을 삭제했어요.');
    await fetchPosts(false);
  } catch (error) {
    console.error('게시글 삭제 오류:', error);
    showToast(error.message || '게시글 삭제에 실패했습니다.');
  }
});

// 앱 초기화 실행
async function init() {
  await backupAndMigrateLocalStorage();
  await fetchPosts();
}

init();
