require('dotenv').config();
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL;

// =========================================================
// 1. Neon Serverless Postgres 구현부 (DATABASE_URL 존재 시)
// =========================================================
if (DATABASE_URL && DATABASE_URL.trim() !== '') {
  console.log('⚡ [DB] Neon Serverless Postgres 연결 모드로 동작합니다.');
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(DATABASE_URL);

  let initPromise = null;
  async function initNeon() {
    if (!initPromise) {
      initPromise = (async () => {
        // 테이블 생성 (외래 키 CASCADE 설정)
        await sql`
          CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            password_hash TEXT
          );
        `;

        await sql`
          CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            password_hash TEXT
          );
        `;

        await sql`CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);`;
        await sql`CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts ("createdAt" DESC);`;
        await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS password_hash TEXT;`;
        await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS password_hash TEXT;`;

        // 초기 데이터 시딩
        const countRes = await sql`SELECT COUNT(*)::int as count FROM posts;`;
        if (countRes[0].count === 0) {
          const now = new Date().toISOString();
          await sql`
            INSERT INTO posts (id, title, author, content, "createdAt", "updatedAt")
            VALUES
              ('1', '담벼락에 오신 것을 환영합니다', '운영자', 'Neon Serverless Postgres와 연동된 담벼락 게시판입니다.\nVercel에 배포해도 모든 사용자의 글과 댓글이 안전하게 저장됩니다.', ${now}, ${now}),
              ('2', 'Neon Postgres 연결 완료', '개발자', '클라우드 데이터베이스인 Neon을 연결하여 다중 사용자 환경과 Vercel 배포 준비를 마쳤습니다.', ${now}, ${now});
          `;
          await sql`
            INSERT INTO comments (id, post_id, author, content, "createdAt")
            VALUES
              ('c-1', '1', '방문자', 'Neon 클라우드 DB 연결을 축하합니다!', ${now}),
              ('c-2', '1', '운영자', '감사합니다. 이제 Vercel에서도 데이터가 영구 보존됩니다.', ${now});
          `;
        }
      })();
    }
    return initPromise;
  }

  const postsRepo = {
    async findAll(searchQuery = '') {
      await initNeon();
      const keyword = (searchQuery || '').trim();
      if (keyword) {
        const pattern = `%${keyword}%`;
        return await sql`
          SELECT
            p.id, p.title, p.author, p.content,
            p."createdAt", p."updatedAt", p.password_hash,
            COUNT(c.id)::int AS "commentCount"
          FROM posts p
          LEFT JOIN comments c ON p.id = c.post_id
          WHERE p.title ILIKE ${pattern} OR p.content ILIKE ${pattern}
          GROUP BY p.id, p.password_hash
          ORDER BY p."createdAt" DESC
        `;
      }
      return await sql`
        SELECT
          p.id, p.title, p.author, p.content,
          p."createdAt", p."updatedAt", p.password_hash,
          COUNT(c.id)::int AS "commentCount"
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        GROUP BY p.id, p.password_hash
        ORDER BY p."createdAt" DESC
      `;
    },

    async findById(id) {
      await initNeon();
      const rows = await sql`
        SELECT
          p.id, p.title, p.author, p.content,
          p."createdAt", p."updatedAt", p.password_hash,
          COUNT(c.id)::int AS "commentCount"
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.id = ${id}
        GROUP BY p.id, p.password_hash
      `;
      return rows[0] || null;
    },

    async create({ id, title, author, content, createdAt, updatedAt, passwordHash }) {
      await initNeon();
      await sql`
        INSERT INTO posts (id, title, author, content, "createdAt", "updatedAt", password_hash)
        VALUES (${id}, ${title}, ${author}, ${content}, ${createdAt}, ${updatedAt}, ${passwordHash})
      `;
      return await this.findById(id);
    },

    async update(id, { title, author, content, updatedAt }) {
      await initNeon();
      const rows = await sql`
        UPDATE posts
        SET title = ${title}, author = ${author}, content = ${content}, "updatedAt" = ${updatedAt}
        WHERE id = ${id}
        RETURNING id, title, author, content, "createdAt", "updatedAt"
      `;
      if (!rows || rows.length === 0) return null;
      return await this.findById(id);
    },

    async delete(id) {
      await initNeon();
      const existing = await this.findById(id);
      if (!existing) return null;
      await sql`DELETE FROM posts WHERE id = ${id}`;
      return existing;
    },

    async importMany(posts, passwordHash) {
      await initNeon();
      let imported = 0;
      for (const post of posts) {
        if (post && post.id && post.title) {
          await sql`
            INSERT INTO posts (id, title, author, content, "createdAt", "updatedAt", password_hash)
            VALUES (
              ${String(post.id)},
              ${String(post.title)},
              ${String(post.author || '익명')},
              ${String(post.content || '')},
              ${post.createdAt || new Date().toISOString()},
              ${post.updatedAt || new Date().toISOString()},
              ${passwordHash}
            )
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              author = EXCLUDED.author,
              content = EXCLUDED.content,
              "updatedAt" = EXCLUDED."updatedAt",
              password_hash = EXCLUDED.password_hash
          `;
          imported++;
        }
      }
      return imported;
    }
  };

  const commentsRepo = {
    async findByPostId(postId) {
      await initNeon();
      return await sql`
        SELECT id, post_id, author, content, "createdAt", password_hash
        FROM comments
        WHERE post_id = ${postId}
        ORDER BY "createdAt" ASC
      `;
    },

    async findById(id) {
      await initNeon();
      const rows = await sql`SELECT * FROM comments WHERE id = ${id}`;
      return rows[0] || null;
    },

    async create({ id, post_id, author, content, createdAt, passwordHash }) {
      await initNeon();
      const rows = await sql`
        INSERT INTO comments (id, post_id, author, content, "createdAt", password_hash)
        VALUES (${id}, ${post_id}, ${author}, ${content}, ${createdAt}, ${passwordHash})
        RETURNING id, post_id, author, content, "createdAt", password_hash
      `;
      return rows[0];
    },

    async delete(id) {
      await initNeon();
      const rows = await sql`
        DELETE FROM comments
        WHERE id = ${id}
        RETURNING id, post_id, author, content, "createdAt", password_hash
      `;
      return rows[0] || null;
    }
  };

  module.exports = {
    dbType: 'neon',
    postsRepo,
    commentsRepo
  };

} else {
  // =========================================================
  // 2. 로컬 SQLite 폴백 구현부 (DATABASE_URL 미설정 시)
  // =========================================================
  if (process.env.VERCEL) {
    throw new Error('Vercel 배포에는 영구 저장소인 DATABASE_URL 설정이 반드시 필요합니다.');
  }
  console.log('📂 [DB] DATABASE_URL이 설정되지 않아 로컬 SQLite 모드로 동작합니다.');
  console.log('👉 [안내] Neon 클라우드 DB를 연동하려면 .env 파일에 DATABASE_URL을 설정해 주세요.');

  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = path.join(__dirname, 'database.sqlite');
  const db = new DatabaseSync(DB_PATH);

  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_createdAt ON posts (createdAt DESC);
  `);

  if (!db.prepare("PRAGMA table_info(posts)").all().some(column => column.name === 'password_hash')) {
    db.exec('ALTER TABLE posts ADD COLUMN password_hash TEXT;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_createdAt ON comments (createdAt ASC);
  `);
  if (!db.prepare("PRAGMA table_info(comments)").all().some(column => column.name === 'password_hash')) {
    db.exec('ALTER TABLE comments ADD COLUMN password_hash TEXT;');
  }

  const postsRepo = {
    async findAll(searchQuery = '') {
      const keyword = (searchQuery || '').trim();
      if (keyword) {
        const pattern = `%${keyword}%`;
        const stmt = db.prepare(`
          SELECT
            p.id, p.title, p.author, p.content, p.createdAt, p.updatedAt, p.password_hash,
            COUNT(c.id) AS commentCount
          FROM posts p
          LEFT JOIN comments c ON p.id = c.post_id
          WHERE p.title LIKE ? OR p.content LIKE ?
          GROUP BY p.id
          ORDER BY p.createdAt DESC
        `);
        return stmt.all(pattern, pattern);
      } else {
        const stmt = db.prepare(`
          SELECT
            p.id, p.title, p.author, p.content, p.createdAt, p.updatedAt, p.password_hash,
            COUNT(c.id) AS commentCount
          FROM posts p
          LEFT JOIN comments c ON p.id = c.post_id
          GROUP BY p.id
          ORDER BY p.createdAt DESC
        `);
        return stmt.all();
      }
    },

    async findById(id) {
      const stmt = db.prepare(`
        SELECT
          p.id, p.title, p.author, p.content, p.createdAt, p.updatedAt, p.password_hash,
          COUNT(c.id) AS commentCount
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.id = ?
        GROUP BY p.id
      `);
      return stmt.get(id) || null;
    },

    async create({ id, title, author, content, createdAt, updatedAt, passwordHash }) {
      const stmt = db.prepare(`
        INSERT INTO posts (id, title, author, content, createdAt, updatedAt, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, title, author, content, createdAt, updatedAt, passwordHash);
      return await this.findById(id);
    },

    async update(id, { title, author, content, updatedAt }) {
      const stmt = db.prepare(`
        UPDATE posts
        SET title = ?, author = ?, content = ?, updatedAt = ?
        WHERE id = ?
      `);
      const result = stmt.run(title, author, content, updatedAt, id);
      if (result.changes === 0) return null;
      return await this.findById(id);
    },

    async delete(id) {
      const existing = await this.findById(id);
      if (!existing) return null;
      const stmt = db.prepare('DELETE FROM posts WHERE id = ?');
      stmt.run(id);
      return existing;
    },

    async importMany(posts, passwordHash) {
      const stmt = db.prepare(`
        INSERT INTO posts (id, title, author, content, createdAt, updatedAt, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author,
          content=excluded.content, updatedAt=excluded.updatedAt, password_hash=excluded.password_hash
      `);
      let imported = 0;
      for (const post of posts) {
        if (post && post.id && post.title) {
          stmt.run(
            String(post.id),
            String(post.title),
            String(post.author || '익명'),
            String(post.content || ''),
            post.createdAt || new Date().toISOString(),
            post.updatedAt || new Date().toISOString(),
            passwordHash
          );
          imported++;
        }
      }
      return imported;
    }
  };

  const commentsRepo = {
    async findByPostId(postId) {
      const stmt = db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY createdAt ASC');
      return stmt.all(postId);
    },

    async findById(id) {
      const stmt = db.prepare('SELECT * FROM comments WHERE id = ?');
      return stmt.get(id) || null;
    },

    async create({ id, post_id, author, content, createdAt, passwordHash }) {
      const stmt = db.prepare(`
        INSERT INTO comments (id, post_id, author, content, createdAt, password_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, post_id, author, content, createdAt, passwordHash);
      return await this.findById(id);
    },

    async delete(id) {
      const existing = await this.findById(id);
      if (!existing) return null;
      const stmt = db.prepare('DELETE FROM comments WHERE id = ?');
      stmt.run(id);
      return existing;
    }
  };

  module.exports = {
    dbType: 'sqlite',
    postsRepo,
    commentsRepo
  };
}
