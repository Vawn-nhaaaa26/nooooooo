import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { connectToSqlServer } from './database/connect.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const envPath = join(root, '.env');

try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.PORT || 8000);
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const { sqlDriver, pool } = await connectToSqlServer(process.env);
const sessionLifetimeSeconds = 8 * 60 * 60;
const cookieName = 'bkspacetech_session';
const googleClient = new OAuth2Client(googleClientId || undefined);
const defaultWhitelist = [
  { id: 'WL-01', email: 'quan.nm@bkspacetech.com', name: 'Nguyễn Minh Quân', role: 'admin', isActive: true },
  { id: 'WL-02', email: 'kiet.lt225034@sis.hust.edu.vn', name: 'Lê Tuấn Kiệt', role: 'department_head', isActive: true },
  { id: 'WL-03', email: 'ha.pt236411@sis.hust.edu.vn', name: 'Phạm Thu Hà', role: 'delegated_member', isActive: true },
  { id: 'WL-04', email: 'cuu.thanhvien@gmail.com', name: 'Phạm Văn Cựu (Đã khóa)', role: 'delegated_member', isActive: false },
  { id: 'WL-05', email: 'vuvietvan26032006@gmail.com', name: 'Vũ Việt Văn', role: 'admin', isActive: true }
];

async function query(statement, parameters = [], transaction = null) {
  let parameterIndex = 0;
  const sqlStatement = statement.replace(/\?/g, () => `@value${parameterIndex++}`);
  if (parameterIndex !== parameters.length) {
    throw new Error(`SQL parameter count mismatch: expected ${parameterIndex}, received ${parameters.length}`);
  }
  const request = transaction ? new sqlDriver.Request(transaction) : pool.request();
  parameters.forEach((value, index) => request.input(`value${index}`, value === undefined ? null : value));
  return request.query(sqlStatement);
}

const database = {
  prepare(statement, transaction = null) {
    return {
      all: async (...parameters) => (await query(statement, parameters, transaction)).recordset,
      get: async (...parameters) => (await query(statement, parameters, transaction)).recordset[0] || null,
      run: async (...parameters) => {
        const result = await query(statement, parameters, transaction);
        return { changes: result.rowsAffected.reduce((total, count) => total + count, 0) };
      }
    };
  },
  exec: (statement, transaction = null) => query(statement, [], transaction)
};

async function withTransaction(callback) {
  const transaction = new sqlDriver.Transaction(pool);
  await transaction.begin();
  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function dateOrFallback(value, fallback = null) {
  if (!value) return fallback;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
  const text = String(value);
  const localizedDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const date = localizedDate
    ? new Date(Date.UTC(
      Number(localizedDate[3]), Number(localizedDate[2]) - 1, Number(localizedDate[1]),
      Number(localizedDate[4] || 0), Number(localizedDate[5] || 0), Number(localizedDate[6] || 0)
    ))
    : new Date(text);
  if (localizedDate &&
      (date.getUTCFullYear() !== Number(localizedDate[3]) ||
       date.getUTCMonth() !== Number(localizedDate[2]) - 1 ||
       date.getUTCDate() !== Number(localizedDate[1]))) {
    return fallback;
  }
  return Number.isNaN(date.getTime()) ? fallback : date;
}

async function getAuthorizedEmails() {
  return (await database.prepare(`
    SELECT id, email, full_name AS name, role_id AS role, is_active AS isActive
    FROM dbo.users
    ORDER BY id
  `).all()).map(user => ({ ...user, isActive: Boolean(user.isActive) }));
}

async function saveWhitelist(users) {
  await withTransaction(async transaction => {
    for (const user of users) {
      const updated = await database.prepare(`
        UPDATE dbo.users SET email = ?, full_name = ?, role_id = ?, is_active = ?,
          updated_at = SYSUTCDATETIME()
        WHERE id = ?
      `, transaction).run(
        user.email, user.name, user.role, Boolean(user.isActive), user.id
      );
      if (!updated.changes) {
        await database.prepare(`
          INSERT INTO dbo.users (id, email, full_name, role_id, is_active)
          VALUES (?, ?, ?, ?, ?)
        `, transaction).run(
          user.id, user.email, user.name, user.role, Boolean(user.isActive)
        );
      }
    }
  });
}

async function writeAuditEntry(actor, action, targetEmail) {
  const user = await database.prepare(
    'SELECT id FROM dbo.users WHERE LOWER(email) = LOWER(?)'
  ).get(actor);
  await database.prepare(`
    INSERT INTO dbo.audit_logs
      (id, actor_id, actor_email, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, N'user', ?, ?, ?)
  `).run(
    `LOG-${randomUUID()}`,
    user?.id || null,
    actor,
    action,
    targetEmail,
    JSON.stringify({ targetEmail }),
    new Date()
  );
}

async function readAuditEntries() {
  const entries = await database.prepare(`
    SELECT TOP (500) id, actor_email AS actor, action, target_id AS targetEmail,
      created_at AS time, details_json
    FROM dbo.audit_logs
    ORDER BY created_at DESC
  `).all();
  return entries.map(({ details_json: detailsJson, ...entry }) => {
    const details = JSON.parse(detailsJson);
    return { ...entry, time: entry.time || details.time || null };
  });
}

async function getRoleAccessData() {
  const roleLabels = {
    department_head: 'Trưởng/phó ban',
    delegated_member: 'Thành viên ủy quyền'
  };
  const [roles, permissions, rolePermissions] = await Promise.all([
    database.prepare('SELECT id, name, description FROM dbo.roles ORDER BY name').all(),
    database.prepare('SELECT id, name, description FROM dbo.permissions ORDER BY id').all(),
    database.prepare(
      'SELECT role_id AS roleId, permission_id AS permissionId FROM dbo.role_permissions'
    ).all()
  ]);
  return {
    roles: roles.map(role => ({ ...role, name: roleLabels[role.id] || role.name })),
    permissions: permissions.map(permission => ({ ...permission, label: permission.name })),
    rolePermissions
  };
}

async function getCMSState(transaction = null) {
  const row = await database.prepare(
    'SELECT version, state_json FROM dbo.cms_state WHERE id = 1',
    transaction
  ).get();
  return row ? { version: row.version, state: JSON.parse(row.state_json) } : { version: 0, state: null };
}

async function initializeDatabase() {
  await database.exec(readFileSync(join(root, 'database', 'schema.sql'), 'utf8'));

  const userCount = await database.prepare('SELECT COUNT(*) AS count FROM dbo.users').get();
  if (userCount.count === 0) {
    await withTransaction(async transaction => {
      for (const user of defaultWhitelist) {
        if (!user?.id || !user.email || !user.name || !isAllowedRole(user.role)) continue;
        await database.prepare(`
          IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = ? OR LOWER(email) = LOWER(?))
          INSERT INTO dbo.users (id, email, full_name, role_id, is_active)
          VALUES (?, ?, ?, ?, ?)
        `, transaction).run(
          user.id, user.email.trim().toLowerCase(),
          user.id, user.email.trim().toLowerCase(), user.name, user.role, Boolean(user.isActive)
        );
      }
    });
  }
}

function slugify(value, fallback) {
  const slug = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || fallback.toLowerCase();
}

async function syncCMSCollectionsToSqlServer(state, transaction) {
  const authorizedEmails = await getAuthorizedEmails();
  const userByEmail = new Map(authorizedEmails.map(user => [user.email.toLowerCase(), user]));
  const userByName = new Map(authorizedEmails.map(user => [user.name.toLowerCase(), user]));
  const departmentIdByName = new Map((state.departments || []).map(item => [item.name, item.id]));
  const categoryIdByName = new Map((state.categories || []).map(item => [item.name, item.id]));
  const memberIdByName = new Map((state.members || []).map(item => [item.fullName, item.id]));
  const userDepartments = await database.prepare(
    'SELECT id, department_id FROM dbo.users WHERE department_id IS NOT NULL',
    transaction
  ).all();
  const statements = [
    'DELETE FROM dbo.content_approvals',
    'DELETE FROM dbo.revisions',
    'DELETE FROM dbo.posts',
    'DELETE FROM dbo.projects',
    'DELETE FROM dbo.activities',
    'DELETE FROM dbo.members',
    'DELETE FROM dbo.categories',
    'DELETE FROM dbo.sponsors',
    'DELETE FROM dbo.media',
    'UPDATE dbo.users SET department_id = NULL WHERE department_id IS NOT NULL',
    'DELETE FROM dbo.departments'
  ];
  for (const statement of statements) await database.exec(statement, transaction);

  const insertDepartment = database.prepare(
    'INSERT INTO dbo.departments (id, name, description) VALUES (?, ?, ?)',
    transaction
  );
  for (const item of state.departments || []) {
    await insertDepartment.run(item.id, item.name, item.description || '');
  }
  const restoreUserDepartment = database.prepare(`
    UPDATE dbo.users SET department_id = ?
    WHERE id = ? AND EXISTS (SELECT 1 FROM dbo.departments WHERE id = ?)
  `, transaction);
  for (const user of userDepartments) {
    await restoreUserDepartment.run(user.department_id, user.id, user.department_id);
  }

  const insertCategory = database.prepare(
    'INSERT INTO dbo.categories (id, name, slug, description) VALUES (?, ?, ?, ?)',
    transaction
  );
  const usedSlugs = new Set();
  for (const item of state.categories || []) {
    let slug = slugify(item.name, item.id);
    if (usedSlugs.has(slug)) slug = `${slug}-${slugify(item.id, 'category')}`;
    usedSlugs.add(slug);
    await insertCategory.run(item.id, item.name, slug, item.description || '');
  }

  const insertMember = database.prepare(`
    INSERT INTO dbo.members
      (id, user_id, department_id, full_name, student_id, email, position, generation, initials, is_executive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.members || []) {
    const user = item.email ? userByEmail.get(item.email.toLowerCase()) : null;
    await insertMember.run(
      item.id, user?.id || null, departmentIdByName.get(item.department) || null,
      item.fullName || item.name || 'Thành viên', item.studentId || null, item.email || null,
      item.position || '', item.generation || '', item.initials || '', item.isExecutive ? 1 : 0
    );
  }

  const insertPost = database.prepare(`
    INSERT INTO dbo.posts
      (id, category_id, author_id, title, slug, excerpt, content, status, review_note, published_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.posts || []) {
    const author = item.author ? userByName.get(item.author.toLowerCase()) : null;
    await insertPost.run(
      item.id, categoryIdByName.get(item.category) || item.categoryId || null, author?.id || null,
      item.title || 'Bài viết', `${slugify(item.title, item.id)}-${slugify(item.id, 'post')}`,
      item.excerpt || '', item.content || '',
      ['draft', 'pending_review', 'published', 'archived'].includes(item.status) ? item.status : 'draft',
      item.reviewNote || '', item.publishedAt || null, item.updatedAt || new Date().toISOString()
    );
  }

  const insertProject = database.prepare(`
    INSERT INTO dbo.projects
      (id, department_id, lead_member_id, name, summary, result, status, progress)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.projects || []) {
    const status = ['planned', 'in_progress', 'testing', 'completed', 'archived'].includes(item.status)
      ? item.status : 'planned';
    await insertProject.run(
      item.id, departmentIdByName.get(item.department) || null, memberIdByName.get(item.lead) || null,
      item.name || 'Dự án', item.summary || '', item.result || '', status,
      Math.max(0, Math.min(100, Number(item.progress) || 0))
    );
  }

  const insertActivity = database.prepare(`
    INSERT INTO dbo.activities
      (id, department_id, title, activity_type, description, location, starts_at, capacity, registered_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.activities || []) {
    const status = ['draft', 'pending_review', 'published', 'cancelled', 'completed'].includes(item.status)
      ? item.status : 'draft';
    await insertActivity.run(
      item.id, departmentIdByName.get(item.department) || null, item.title || 'Hoạt động',
      ['event', 'training', 'meeting', 'other'].includes(item.type) ? item.type : 'other',
      item.description || '', item.location || '', item.date || null,
      Math.max(0, Number(item.capacity) || 0), Math.max(0, Number(item.registered) || 0), status
    );
  }

  const insertMedia = database.prepare(`
    INSERT INTO dbo.media (id, name, storage_key, media_type, mime_type, alt_text)
    VALUES (?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.media || []) {
    const mediaType = ['image', 'video', 'document', 'other'].includes(item.mediaType)
      ? item.mediaType
      : ['image', 'video', 'document'].includes(item.type) ? item.type : 'other';
    await insertMedia.run(item.id, item.name || item.id, `${item.url || item.name || item.id}#${item.id}`,
      mediaType, item.mimeType || '', item.altText || '');
  }

  const insertSponsor = database.prepare(`
    INSERT INTO dbo.sponsors (id, name, tier, website, is_active)
    VALUES (?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.sponsors || []) {
    await insertSponsor.run(item.id, item.name || 'Nhà tài trợ', item.tier || '', item.website || '', item.active ? 1 : 0);
  }

  const insertRevision = database.prepare(`
    INSERT INTO dbo.revisions (id, content_type, content_id, editor_id, action, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.revisions || []) {
    const contentType = ['post', 'project', 'activity'].includes(item.contentType) ? item.contentType : 'post';
    const editor = item.editor ? userByEmail.get(item.editor.toLowerCase()) : null;
    await insertRevision.run(item.id, contentType, item.contentId, editor?.id || null, item.action || 'edit',
      typeof item.snapshot === 'string' ? item.snapshot : JSON.stringify(item.snapshot || {}),
      dateOrFallback(item.time, new Date()));
  }

  const insertApproval = database.prepare(`
    INSERT INTO dbo.content_approvals
      (id, post_id, submitted_by, reviewer_id, status, note, submitted_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.contentApprovals || []) {
    if (!(state.posts || []).some(post => post.id === item.contentId)) continue;
    const submitter = item.submittedBy ? userByEmail.get(item.submittedBy.toLowerCase()) : null;
    const reviewer = item.reviewer ? userByEmail.get(item.reviewer.toLowerCase()) : null;
    const status = ['pending', 'approved', 'changes_requested', 'rejected'].includes(item.status)
      ? item.status : 'pending';
    await insertApproval.run(item.id, item.contentId, submitter?.id || null, reviewer?.id || null, status,
      item.note || '', dateOrFallback(item.submittedAt, new Date()), dateOrFallback(item.reviewedAt));
  }

  const insertAudit = database.prepare(`
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE id = ?)
    INSERT INTO dbo.audit_logs
      (id, actor_email, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, transaction);
  for (const item of state.auditLogs || []) {
    if (!item.id || !item.action) continue;
    await insertAudit.run(item.id, item.id, item.actor || '', item.action, item.source || 'cms',
      item.targetEmail || '', JSON.stringify(item), dateOrFallback(item.time));
  }
}

function isValidCMSState(state) {
  return state && typeof state === 'object' && !Array.isArray(state) &&
    ['posts', 'projects', 'activities', 'members', 'departments', 'media', 'sponsors',
      'categories', 'revisions', 'contentApprovals', 'auditLogs'].every(key => Array.isArray(state[key])) &&
    state.baselineCounts && typeof state.baselineCounts === 'object' &&
    state.siteSettings && typeof state.siteSettings === 'object';
}

async function canSaveCMSChanges(previous, next, user) {
  const permissions = new Set(
    (await database.prepare('SELECT permission_id FROM dbo.role_permissions WHERE role_id = ?')
      .all(user.role)).map(row => row.permission_id)
  );
  const can = permission => permissions.has(permission);
  const collections = [
    ['posts', 'content.create', 'content.edit', 'content.delete'],
    ['projects', 'content.create', 'content.edit', 'content.delete'],
    ['activities', 'content.create', 'content.edit', 'content.delete'],
    ['categories', 'content.edit', 'content.edit', 'content.delete'],
    ['members', 'members.manage', 'members.manage', 'members.manage'],
    ['departments', 'members.manage', 'members.manage', 'members.manage'],
    ['media', 'content.edit', 'content.edit', 'content.delete'],
    ['sponsors', 'settings.manage', 'settings.manage', 'settings.manage'],
    ['revisions', 'content.edit', 'content.edit', 'content.delete']
  ];

  for (const [key, createPermission, editPermission, deletePermission] of collections) {
    const oldItems = new Map((previous[key] || []).map(item => [item.id, item]));
    const newItems = new Map((next[key] || []).map(item => [item.id, item]));
    for (const [id, item] of newItems) {
      const oldItem = oldItems.get(id);
      if (!oldItem && !can(createPermission)) return false;
      if (oldItem && JSON.stringify(oldItem) !== JSON.stringify(item) && !can(editPermission)) return false;
    }
    for (const id of oldItems.keys()) {
      if (!newItems.has(id) && !can(deletePermission)) return false;
    }
  }

  const oldApprovals = new Map((previous.contentApprovals || []).map(item => [item.id, item]));
  const newApprovals = new Map((next.contentApprovals || []).map(item => [item.id, item]));
  for (const [id, item] of newApprovals) {
    const oldItem = oldApprovals.get(id);
    if (!oldItem && item.status !== 'pending' && !can('content.approve')) return false;
    if (!oldItem && item.status === 'pending' && !can('content.create')) return false;
    if (oldItem && JSON.stringify(oldItem) !== JSON.stringify(item) && !can('content.approve')) return false;
  }
  for (const id of oldApprovals.keys()) {
    if (!newApprovals.has(id) && !can('content.delete')) return false;
  }

  const oldPosts = new Map((previous.posts || []).map(item => [item.id, item]));
  for (const post of next.posts || []) {
    const oldPost = oldPosts.get(post.id);
    if (oldPost && oldPost.status !== post.status &&
        ['published', 'archived'].includes(post.status) && !can('content.create')) return false;
  }

  const oldActivities = new Map((previous.activities || []).map(item => [item.id, item]));
  for (const activity of next.activities || []) {
    const oldActivity = oldActivities.get(activity.id);
    if (activity.status === 'published' &&
        (!oldActivity || oldActivity.status !== 'published') &&
        !can('content.create')) return false;
  }

  if (JSON.stringify(previous.siteSettings) !== JSON.stringify(next.siteSettings) && !can('settings.manage')) return false;
  if (JSON.stringify(previous.baselineCounts) !== JSON.stringify(next.baselineCounts) && !can('settings.manage')) return false;
  return true;
}

async function saveCMSState(state, expectedVersion) {
  const serializedState = JSON.stringify(state);
  if (Buffer.byteLength(serializedState, 'utf8') > 2_000_000) {
    throw new Error('CMS data is too large to store.');
  }
  const transaction = new sqlDriver.Transaction(pool);
  await transaction.begin();
  try {
    const row = await database.prepare(`
      SELECT version, state_json FROM dbo.cms_state WITH (UPDLOCK, HOLDLOCK) WHERE id = 1
    `, transaction).get();
    const currentVersion = row ? row.version : 0;
    if (expectedVersion !== currentVersion) {
      await transaction.rollback();
      return { conflict: true, version: currentVersion };
    }

    if (currentVersion === 0) {
      await database.prepare(`
        INSERT INTO dbo.cms_state (id, version, state_json, updated_at)
        VALUES (1, 1, ?, SYSUTCDATETIME())
      `, transaction).run(serializedState);
    } else {
      const result = await database.prepare(`
        UPDATE dbo.cms_state SET version = version + 1, state_json = ?, updated_at = SYSUTCDATETIME()
        WHERE id = 1 AND version = ?
      `, transaction).run(serializedState, expectedVersion);
      if (result.changes !== 1) {
        await transaction.rollback();
        return { conflict: true, version: (await getCMSState()).version };
      }
    }

    await syncCMSCollectionsToSqlServer(state, transaction);
    await transaction.commit();
    return { conflict: false, version: currentVersion + 1 };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function getPublicCMSState() {
  const { state } = await getCMSState();
  if (!state) return { state: null };
  return {
    state: {
      baselineCounts: state.baselineCounts,
      siteSettings: state.siteSettings,
      posts: state.posts.filter(post => post.status === 'published'),
      projects: state.projects,
      activities: state.activities.filter(activity => activity.status === 'published'),
      members: state.members.filter(member => member.isExecutive).map(member => ({
        id: member.id,
        initials: member.initials,
        fullName: member.fullName,
        position: member.position
      })),
      sponsors: state.sponsors.filter(sponsor => sponsor.active)
    }
  };
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

async function readSession(request) {
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0
      ? ['', '']
      : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
  const value = cookies[cookieName];
  if (!value) return null;

  const [encoded, suppliedSignature] = value.split('.');
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = createHmac('sha256', sessionSecret).update(encoded).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.sub || !payload.email || payload.exp <= Date.now()) return null;
  const user = await database.prepare(`
    SELECT id, email, full_name AS name, role_id AS role, is_active AS isActive
    FROM dbo.users
    WHERE LOWER(email) = LOWER(?) AND is_active = 1
  `).get(payload.email);
  return user ? {
    ...user,
    isActive: Boolean(user.isActive),
    sub: payload.sub,
    exp: payload.exp,
    dashboardUnlocked: payload.dashboardUnlocked === true
  } : null;
}

function sessionCookie(value, maxAge) {
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

async function readJsonBody(request, maximumBytes = 16_384) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new Error('Request body is too large');
  }
  return JSON.parse(body || '{}');
}

function isAllowedRole(role) {
  return ['admin', 'chairperson', 'department_head', 'delegated_member'].includes(role);
}

async function requireAdmin(request, response) {
  const user = await readSession(request);
  if (!user) {
    sendJson(response, 401, { error: 'Đăng nhập Google để tiếp tục.' });
    return null;
  }
  if (user.role !== 'admin') {
    sendJson(response, 403, { error: 'Chỉ Admin mới được quản lý whitelist.' });
    return null;
  }
  if (!user.dashboardUnlocked) {
    sendJson(response, 403, { error: 'Nhập mật khẩu Dashboard trước khi quản lý whitelist.' });
    return null;
  }
  return user;
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function handleRequest(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    sendJson(response, 400, { error: 'Đường dẫn không hợp lệ.' });
    return;
  }

  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(302, { Location: '/trangchu.html' }).end();
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/config') {
    sendJson(response, 200, { configured: Boolean(googleClientId), clientId: googleClientId });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/session') {
    const user = await readSession(request);
    sendJson(response, 200, user
      ? {
        authenticated: true,
        dashboardUnlocked: user.dashboardUnlocked,
        user: { email: user.email, name: user.name, role: user.role }
      }
      : { authenticated: false });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/cms/public') {
    try {
      sendJson(response, 200, await getPublicCMSState());
    } catch (error) {
      console.error('Public CMS state read failed:', error);
      sendJson(response, 500, { error: 'Không thể tải dữ liệu trang chủ.' });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/cms/state') {
    const user = await readSession(request);
    if (!user) {
      sendJson(response, 401, { error: 'Đăng nhập Google để tiếp tục.' });
      return;
    }
    if (!user.dashboardUnlocked) {
      sendJson(response, 403, { error: 'Mở khóa Dashboard trước khi truy cập dữ liệu CMS.' });
      return;
    }
    try {
      const result = await getCMSState();
      if (result.state) {
        result.state.authorizedEmails = user.role === 'admin' ? await getAuthorizedEmails() : [];
        result.state.users = user.role === 'admin'
          ? result.state.authorizedEmails.map(entry => ({ ...entry, roleId: entry.role }))
          : [];
        Object.assign(result.state, await getRoleAccessData());
      }
      sendJson(response, 200, result);
    } catch (error) {
      console.error('CMS state read failed:', error);
      sendJson(response, 500, { error: 'Không thể đọc dữ liệu CMS từ SQL Server.' });
    }
    return;
  }

  if (request.method === 'PUT' && pathname === '/api/cms/state') {
    const user = await readSession(request);
    if (!user) {
      sendJson(response, 401, { error: 'Đăng nhập Google để tiếp tục.' });
      return;
    }
    if (!user.dashboardUnlocked) {
      sendJson(response, 403, { error: 'Mở khóa Dashboard trước khi lưu dữ liệu CMS.' });
      return;
    }
    try {
      const { state, expectedVersion } = await readJsonBody(request, 2_100_000);
      if (!isValidCMSState(state) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
        sendJson(response, 400, { error: 'Dữ liệu CMS hoặc phiên bản lưu không hợp lệ.' });
        return;
      }
      const currentAuthorizedEmails = user.role === 'admin' ? await getAuthorizedEmails() : [];
      const safeState = {
        ...state,
        authorizedEmails: currentAuthorizedEmails,
        users: user.role === 'admin'
          ? currentAuthorizedEmails.map(entry => ({ ...entry, roleId: entry.role }))
          : [],
        ...await getRoleAccessData()
      };
      const currentState = (await getCMSState()).state;
      if (currentState && !await canSaveCMSChanges(currentState, safeState, user)) {
        sendJson(response, 403, { error: 'Tài khoản không có quyền thực hiện một hoặc nhiều thay đổi được gửi.' });
        return;
      }
      if (currentState) safeState.auditLogs = currentState.auditLogs;
      const result = await saveCMSState(safeState, expectedVersion);
      if (result.conflict) {
        sendJson(response, 409, {
          error: 'Dữ liệu CMS đã được thay đổi ở phiên khác. Hãy tải lại trang để tránh ghi đè.',
          version: result.version
        });
        return;
      }
      sendJson(response, 200, { saved: true, version: result.version });
    } catch (error) {
      console.error('CMS state save failed:', error);
      sendJson(response, error.message === 'CMS data is too large to store.' ? 413 : 500, {
        error: error.message === 'CMS data is too large to store.'
          ? 'Dữ liệu CMS vượt quá giới hạn lưu trữ.'
          : 'Không thể lưu dữ liệu CMS vào SQL Server.'
      });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/google') {
    if (!googleClientId) {
      sendJson(response, 503, { error: 'Máy chủ chưa được cấu hình GOOGLE_CLIENT_ID.' });
      return;
    }
    try {
      const { credential } = await readJsonBody(request);
      if (typeof credential !== 'string' || credential.length > 12_000) {
        sendJson(response, 400, { error: 'Google credential không hợp lệ.' });
        return;
      }
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        sendJson(response, 401, { error: 'Google không xác minh được địa chỉ email.' });
        return;
      }
      const user = await database.prepare(`
        SELECT id, email, full_name AS name, role_id AS role
        FROM dbo.users
        WHERE is_active = 1 AND LOWER(email) = LOWER(?)
      `).get(payload.email);
      if (!user) {
        sendJson(response, 403, { error: 'Tài khoản Google này chưa được cấp quyền Dashboard.' });
        return;
      }
      const expiresAt = Date.now() + sessionLifetimeSeconds * 1000;
      const session = signSession({
        sub: payload.sub,
        email: user.email,
        name: user.name || payload.name || user.email,
        exp: expiresAt,
        dashboardUnlocked: false
      });
      sendJson(response, 200, {
        authenticated: true,
        user: { email: user.email, name: user.name, role: user.role }
      }, { 'Set-Cookie': sessionCookie(session, sessionLifetimeSeconds) });
    } catch (error) {
      console.error('Google sign-in failed:', error);
      sendJson(response, 401, { error: 'Không thể xác thực tài khoản Google. Vui lòng thử lại.' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/dashboard-password') {
    const user = await readSession(request);
    if (!user) {
      sendJson(response, 401, { error: 'Hãy chờ Google xác minh tài khoản được cấp quyền.' });
      return;
    }
    if (!dashboardPassword) {
      sendJson(response, 503, { error: 'Máy chủ chưa cấu hình mật khẩu Dashboard.' });
      return;
    }
    try {
      const { password } = await readJsonBody(request);
      if (typeof password !== 'string' || password.length > 256) {
        sendJson(response, 400, { error: 'Mật khẩu không hợp lệ.' });
        return;
      }
      const expected = Buffer.from(dashboardPassword);
      const supplied = Buffer.from(password);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        sendJson(response, 401, { error: 'Mật khẩu không chính xác. Vui lòng thử lại.' });
        return;
      }
      const expiresIn = Math.max(1, Math.floor((user.exp - Date.now()) / 1000));
      const unlockedSession = signSession({
        sub: user.sub,
        email: user.email,
        name: user.name,
        exp: user.exp,
        dashboardUnlocked: true
      });
      await writeAuditEntry(user.email, 'Mở khóa Dashboard bằng mật khẩu', user.email);
      sendJson(response, 200, {
        authenticated: true,
        dashboardUnlocked: true,
        user: { email: user.email, name: user.name, role: user.role }
      }, { 'Set-Cookie': sessionCookie(unlockedSession, expiresIn) });
    } catch (error) {
      console.error('Dashboard password verification failed:', error);
      sendJson(response, 400, { error: 'Không thể xác minh mật khẩu Dashboard.' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/dashboard-lock') {
    const user = await readSession(request);
    if (!user) {
      sendJson(response, 401, { error: 'Phiên Google đã hết hạn.' });
      return;
    }
    const lockedSession = signSession({
      sub: user.sub,
      email: user.email,
      name: user.name,
      exp: user.exp,
      dashboardUnlocked: false
    });
    const expiresIn = Math.max(1, Math.floor((user.exp - Date.now()) / 1000));
    sendJson(response, 200, { authenticated: true, dashboardUnlocked: false }, {
      'Set-Cookie': sessionCookie(lockedSession, expiresIn)
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    response.writeHead(204, {
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookie('', 0)
    }).end();
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/whitelist') {
    if (!await requireAdmin(request, response)) return;
    sendJson(response, 200, { authorizedEmails: await getAuthorizedEmails() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/audit-log') {
    if (!await requireAdmin(request, response)) return;
    try {
      sendJson(response, 200, { auditLog: await readAuditEntries() });
    } catch (error) {
      console.error('Audit log read failed:', error);
      sendJson(response, 500, { error: 'Không thể đọc nhật ký hoạt động từ SQL Server.' });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/whitelist') {
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    try {
      const { email, name, role } = await readJsonBody(request);
      if (typeof email !== 'string' || typeof name !== 'string' || typeof role !== 'string') {
        sendJson(response, 400, { error: 'Vui lòng nhập email, họ tên và vai trò.' });
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        sendJson(response, 400, { error: 'Địa chỉ email không hợp lệ.' });
        return;
      }
      if (normalizedName.length < 2 || normalizedName.length > 100) {
        sendJson(response, 400, { error: 'Họ tên phải có từ 2 đến 100 ký tự.' });
        return;
      }
      if (!isAllowedRole(role)) {
        sendJson(response, 400, { error: 'Vai trò được chọn không hợp lệ.' });
        return;
      }
      const authorizedEmails = await getAuthorizedEmails();
      if (authorizedEmails.some(entry => entry.email.toLowerCase() === normalizedEmail)) {
        sendJson(response, 409, { error: 'Email này đã có trong danh sách cấp quyền.' });
        return;
      }
      const nextId = authorizedEmails.reduce((highest, entry) => {
        const number = Number(entry.id.match(/^WL-(\d+)$/)?.[1] || 0);
        return Math.max(highest, number);
      }, 0) + 1;
      const item = {
        id: `WL-${String(nextId).padStart(2, '0')}`,
        email: normalizedEmail,
        name: normalizedName,
        role,
        isActive: true
      };
      try {
        await saveWhitelist([...authorizedEmails, item]);
        await writeAuditEntry(admin.email, 'Cấp quyền tài khoản mới', item.email);
      } catch (error) {
        try {
          await saveWhitelist(authorizedEmails);
        } catch (rollbackError) {
          console.error('Whitelist rollback failed:', rollbackError);
        }
        throw error;
      }
      sendJson(response, 201, { item });
    } catch (error) {
      console.error('Whitelist account creation failed:', error);
      sendJson(response, 500, { error: 'Không thể lưu tài khoản mới vào whitelist.' });
    }
    return;
  }

  const whitelistMatch = pathname.match(/^\/api\/auth\/whitelist\/([A-Za-z0-9-]+)$/);
  if (request.method === 'PUT' && whitelistMatch) {
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    try {
      const { isActive } = await readJsonBody(request);
      if (typeof isActive !== 'boolean') {
        sendJson(response, 400, { error: 'isActive phải là boolean.' });
        return;
      }
      const authorizedEmails = await getAuthorizedEmails();
      const item = authorizedEmails.find(entry => entry.id === whitelistMatch[1]);
      if (!item) {
        sendJson(response, 404, { error: 'Không tìm thấy tài khoản trong whitelist.' });
        return;
      }
      if (!isActive && item.email.toLowerCase() === admin.email.toLowerCase()) {
        sendJson(response, 409, { error: 'Không thể tự khóa tài khoản Admin đang đăng nhập.' });
        return;
      }
      if (!isActive && item.role === 'admin' &&
          authorizedEmails.filter(entry => entry.role === 'admin' && entry.isActive).length === 1) {
        sendJson(response, 409, { error: 'Không thể khóa Admin đang hoạt động cuối cùng.' });
        return;
      }
      const previousState = item.isActive;
      item.isActive = isActive;
      try {
        await saveWhitelist(authorizedEmails);
        await writeAuditEntry(admin.email, isActive ? 'Mở khóa tài khoản' : 'Khóa tài khoản', item.email);
      } catch (error) {
        item.isActive = previousState;
        try {
          await saveWhitelist(authorizedEmails);
        } catch (rollbackError) {
          console.error('Whitelist rollback failed:', rollbackError);
        }
        throw error;
      }
      sendJson(response, 200, { item });
    } catch (error) {
      console.error('Whitelist update failed:', error);
      sendJson(response, 500, { error: 'Không thể lưu thay đổi whitelist.' });
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/dashboard.html') {
    const user = await readSession(request);
    if (!user?.dashboardUnlocked) {
      response.writeHead(302, { Location: '/trangchu.html?password=required' }).end();
      return;
    }
  }

  if (request.method === 'GET' && pathname === '/login.html') {
    response.writeHead(302, { Location: '/trangchu.html' }).end();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ.' }, { Allow: 'GET, HEAD' });
    return;
  }

  const requestedPath = pathname === '/' ? '/trangchu.html' : pathname;
  const filePath = resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${sep}`) || extname(filePath).toLowerCase() !== '.html') {
    sendJson(response, 404, { error: 'Không tìm thấy trang.' });
    return;
  }

  try {
    const content = readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': pathname === '/dashboard.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Không tìm thấy trang.' });
      return;
    }
    console.error('Static file read failed:', error);
    sendJson(response, 500, { error: 'Không thể tải trang.' });
  }
}

await initializeDatabase();

createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error('Request failed:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Lỗi máy chủ.' });
    else response.destroy();
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`BK SpaceTech CMS: http://127.0.0.1:${port}/trangchu.html`);
  if (!googleClientId) {
    console.warn('Google sign-in is disabled until GOOGLE_CLIENT_ID is set in .env.');
  }
});
