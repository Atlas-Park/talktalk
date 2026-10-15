require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { postsRepo, commentsRepo, dbType } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// 미들웨어 설정
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(value => value.trim()).filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('허용되지 않은 출처입니다.'));
    }
  }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const hashKey = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};
const verifyPassword = (password, stored) => {
  if (typeof password !== 'string' || !stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const validPassword = value => typeof value === 'string' && value.length >= 4 && value.length <= 64;
const isAdmin = req => {
  const configured = process.env.ADMIN_TOKEN;
  const supplied = req.get('x-admin-token');
  if (!configured || !supplied) return false;
  const a = Buffer.from(hashKey(configured));
  const b = Buffer.from(hashKey(supplied));
  return crypto.timingSafeEqual(a, b);
};
const cleanRequiredString = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
};
const presentPost = post => {
  if (!post) return null;
  const { password_hash: _passwordHash, ...publicPost } = post;
  return publicPost;
};
const presentComment = comment => {
  const { password_hash: _passwordHash, ...publicComment } = comment;
  return publicComment;
};

// 정적 파일 서빙 (프론트엔드)
app.use(express.static(path.join(__dirname, 'dist')));
// Vercel의 /dist/* rewrite 경로도 동일한 정적 디렉터리로 연결
app.use('/dist', express.static(path.join(__dirname, 'dist')));

/* =========================================================
   게시글 (Posts) API
========================================================= */

// 1. 게시글 목록 조회 및 검색 (댓글 개수 포함, 최신 작성순)
app.get('/api/posts', async (req, res) => {
  try {
    const searchKeyword = req.query.q || '';
    const posts = await postsRepo.findAll(searchKeyword);
    res.json(posts.map(presentPost));
  } catch (err) {
    console.error('게시글 목록 조회 오류:', err);
    res.status(500).json({ message: '게시글 목록을 불러오지 못했습니다.' });
  }
});

// 2. 단일 게시글 상세 조회
app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await postsRepo.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    }
    res.json(presentPost(post));
  } catch (err) {
    console.error('게시글 상세 조회 오류:', err);
    res.status(500).json({ message: '게시글 조회 중 오류가 발생했습니다.' });
  }
});

// 3. 게시글 작성
app.post('/api/posts', async (req, res) => {
  const title = cleanRequiredString(req.body.title, 80);
  const author = cleanRequiredString(req.body.author, 24);
  const content = cleanRequiredString(req.body.content, 5000);
  const { password } = req.body;
  if (!title || !author || !content || !validPassword(password)) {
    return res.status(400).json({ message: '제목, 작성자, 본문과 4~64자의 비밀번호가 필요합니다.' });
  }

  try {
    const now = new Date().toISOString();
    const newPost = await postsRepo.create({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title, author, content, passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now
    });

    res.status(201).json(presentPost(newPost));
  } catch (err) {
    console.error('게시글 등록 오류:', err);
    res.status(500).json({ message: '게시글 등록에 실패했습니다.' });
  }
});

// 4. 게시글 수정
app.put('/api/posts/:id', async (req, res) => {
  const title = cleanRequiredString(req.body.title, 80);
  const author = cleanRequiredString(req.body.author, 24);
  const content = cleanRequiredString(req.body.content, 5000);
  const { password } = req.body;
  if (!title || !author || !content || (!isAdmin(req) && !validPassword(password))) {
    return res.status(400).json({ message: '제목, 작성자, 본문과 비밀번호가 필요합니다.' });
  }

  try {
    const existing = await postsRepo.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (!isAdmin(req) && !verifyPassword(password, existing.password_hash)) {
      return res.status(403).json({ message: '이 게시글을 수정할 권한이 없습니다.' });
    }
    const updatedPost = await postsRepo.update(req.params.id, {
      title, author, content,
      updatedAt: new Date().toISOString()
    });

    if (!updatedPost) {
      return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    }

    res.json(presentPost(updatedPost));
  } catch (err) {
    console.error('게시글 수정 오류:', err);
    res.status(500).json({ message: '게시글 수정에 실패했습니다.' });
  }
});

// 5. 게시글 삭제 (외래 키 CASCADE로 관련 댓글도 자동 삭제)
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const existing = await postsRepo.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (!isAdmin(req) && !verifyPassword(req.body?.password, existing.password_hash)) {
      return res.status(403).json({ message: '이 게시글을 삭제할 권한이 없습니다.' });
    }
    const deletedPost = await postsRepo.delete(req.params.id);
    if (!deletedPost) {
      return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    }

    res.json({ message: '게시글과 관련 댓글이 모두 삭제되었습니다.', post: presentPost(deletedPost) });
  } catch (err) {
    console.error('게시글 삭제 오류:', err);
    res.status(500).json({ message: '게시글 삭제에 실패했습니다.' });
  }
});

/* =========================================================
   댓글 (Comments) API
========================================================= */

// 6. 특정 게시글의 댓글 목록 조회
app.get('/api/posts/:postId/comments', async (req, res) => {
  try {
    const comments = await commentsRepo.findByPostId(req.params.postId);
    res.json(comments.map(presentComment));
  } catch (err) {
    console.error('댓글 목록 조회 오류:', err);
    res.status(500).json({ message: '댓글 목록을 불러오지 못했습니다.' });
  }
});

// 7. 특정 게시글에 댓글 작성
app.post('/api/posts/:postId/comments', async (req, res) => {
  const author = cleanRequiredString(req.body.author, 20);
  const content = cleanRequiredString(req.body.content, 500);
  const { password } = req.body;
  const { postId } = req.params;

  if (!author || !content || !validPassword(password)) {
    return res.status(400).json({ message: '작성자, 댓글 내용과 4~64자의 비밀번호가 필요합니다.' });
  }

  try {
    const post = await postsRepo.findById(postId);
    if (!post) {
      return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    }

    const now = new Date().toISOString();
    const newComment = await commentsRepo.create({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      post_id: postId,
      author, content, passwordHash: hashPassword(password),
      createdAt: now
    });

    res.status(201).json(presentComment(newComment));
  } catch (err) {
    console.error('댓글 등록 오류:', err);
    res.status(500).json({ message: '댓글 등록에 실패했습니다.' });
  }
});

// 8. 댓글 삭제
app.delete('/api/comments/:id', async (req, res) => {
  try {
    const existing = await commentsRepo.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    if (!isAdmin(req) && !verifyPassword(req.body?.password, existing.password_hash)) {
      return res.status(403).json({ message: '이 댓글을 삭제할 권한이 없습니다.' });
    }
    const deleted = await commentsRepo.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    }

    res.json({ message: '댓글이 삭제되었습니다.', comment: presentComment(deleted) });
  } catch (err) {
    console.error('댓글 삭제 오류:', err);
    res.status(500).json({ message: '댓글 삭제에 실패했습니다.' });
  }
});

/* =========================================================
   localStorage 백업 API
========================================================= */

app.post('/api/backup-localstorage', async (req, res) => {
  try {
    const migrationToken = req.get('x-migration-token');
    if (!process.env.MIGRATION_TOKEN || migrationToken !== process.env.MIGRATION_TOKEN) {
      return res.status(403).json({ message: '마이그레이션 권한이 없습니다.' });
    }
    const { posts } = req.body;
    if (!Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ message: '백업할 게시글 데이터가 없습니다.' });
    }

    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `localstorage_backup_${timestamp}.json`);
    const latestFile = path.join(backupDir, 'localstorage_backup_latest.json');

    const backupPayload = {
      backupDate: new Date().toISOString(),
      itemCount: posts.length,
      posts: posts
    };

    try {
      fs.writeFileSync(backupFile, JSON.stringify(backupPayload, null, 2), 'utf-8');
      fs.writeFileSync(latestFile, JSON.stringify(backupPayload, null, 2), 'utf-8');
    } catch (fsErr) {
      console.warn('파일 백업 건너뜀 (서버리스 읽기 전용 환경일 수 있음):', fsErr.message);
    }

    const importedCount = await postsRepo.importMany(posts, hashPassword(process.env.MIGRATION_TOKEN));

    res.json({
      success: true,
      message: 'localStorage 데이터 백업 및 마이그레이션이 완료되었습니다.',
      backupFile: path.basename(backupFile),
      importedCount
    });
  } catch (err) {
    console.error('localStorage 백업 중 오류:', err);
    res.status(500).json({ message: '데이터 백업 중 오류가 발생했습니다.' });
  }
});

// SPA 라우트 대응 (정적 서빙 기본 라우트)
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API 경로를 찾을 수 없습니다.' });
});
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 로컬 환경 또는 단독 실행 시 리스닝
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다. (${dbType === 'neon' ? 'Neon Postgres' : 'SQLite'} 모드)`);
  });
}

module.exports = app;
