import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToSqlServer } from '../database/connect.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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

const sourcePath = resolve(root, 'data', 'bkspacetech.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
const { sqlDriver, pool } = await connectToSqlServer(process.env);
const primaryKeys = {
  roles: ['id'],
  permissions: ['id'],
  role_permissions: ['role_id', 'permission_id'],
  departments: ['id'],
  users: ['id'],
  categories: ['id'],
  members: ['id'],
  posts: ['id'],
  projects: ['id'],
  activities: ['id'],
  media: ['id'],
  sponsors: ['id'],
  revisions: ['id'],
  content_approvals: ['id'],
  audit_logs: ['id'],
  cms_state: ['id']
};
const sqlDateColumns = new Set([
  'roles.created_at',
  'departments.created_at', 'departments.updated_at',
  'users.created_at', 'users.updated_at', 'users.last_login_at',
  'categories.created_at', 'categories.updated_at',
  'members.created_at', 'members.updated_at',
  'posts.created_at',
  'projects.created_at', 'projects.updated_at',
  'activities.created_at', 'activities.updated_at',
  'media.created_at',
  'sponsors.created_at', 'sponsors.updated_at',
  'revisions.created_at',
  'content_approvals.submitted_at', 'content_approvals.reviewed_at',
  'audit_logs.created_at',
  'cms_state.updated_at'
]);
const tables = Object.keys(primaryKeys);
const quoteIdentifier = value => `[${value.replace(/]/g, ']]')}]`;

function sqlValue(table, column, value) {
  if (value === null || value === undefined || !sqlDateColumns.has(`${table}.${column}`)) {
    return value ?? null;
  }
  const text = String(value);
  const vietnameseDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = vietnameseDate
    ? new Date(Date.UTC(
      Number(vietnameseDate[3]), Number(vietnameseDate[2]) - 1, Number(vietnameseDate[1]),
      Number(vietnameseDate[4] || 0), Number(vietnameseDate[5] || 0), Number(vietnameseDate[6] || 0)
    ))
    : new Date(normalized);
  const hasInvalidCalendarDate = vietnameseDate && (
    date.getUTCFullYear() !== Number(vietnameseDate[3]) ||
    date.getUTCMonth() !== Number(vietnameseDate[2]) - 1 ||
    date.getUTCDate() !== Number(vietnameseDate[1])
  );
  if (Number.isNaN(date.getTime()) || hasInvalidCalendarDate) {
    if (table === 'audit_logs' && column === 'created_at') {
      console.warn(`Keeping unparseable audit timestamp "${text}" in audit_logs.details_json.`);
      return null;
    }
    throw new Error(`Invalid SQL Server date in ${table}.${column}: ${text}`);
  }
  return date;
}

async function migrate() {
  await pool.request().query(readFileSync(join(root, 'database', 'schema.sql'), 'utf8'));
  const transaction = new sqlDriver.Transaction(pool);
  await transaction.begin();
  const counts = {};

  try {
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM "${table}"`).all();
      const keys = primaryKeys[table];
      let migrated = 0;
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(column => sqlValue(table, column, row[column]));
        const request = new sqlDriver.Request(transaction);
        let parameterIndex = 0;
        const bind = value => {
          const name = `value${parameterIndex++}`;
          request.input(name, value);
          return `@${name}`;
        };
        const keyPredicates = () => keys.map(key => {
          const index = columns.indexOf(key);
          if (index < 0) throw new Error(`Missing primary key ${table}.${key}`);
          return `${quoteIdentifier(key)} = ${bind(values[index])}`;
        });
        const insert = `INSERT INTO dbo.${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
          VALUES (${values.map(bind).join(', ')})`;
        const existsPredicate = keyPredicates();
        const updateAssignments = columns.filter(column => !keys.includes(column))
          .map(column => `${quoteIdentifier(column)} = ${bind(values[columns.indexOf(column)])}`);
        const updatePredicate = updateAssignments.length ? keyPredicates() : null;
        const statement = updateAssignments.length
          ? `IF EXISTS (SELECT 1 FROM dbo.${quoteIdentifier(table)} WHERE ${existsPredicate.join(' AND ')})
             UPDATE dbo.${quoteIdentifier(table)} SET ${updateAssignments.join(', ')}
             WHERE ${updatePredicate.join(' AND ')}
           ELSE ${insert}`
          : `IF NOT EXISTS (SELECT 1 FROM dbo.${quoteIdentifier(table)} WHERE ${existsPredicate.join(' AND ')})
             ${insert}`;
        await request.query(statement);
        migrated += 1;
      }
      counts[table] = migrated;
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  console.log(`Migrated SQLite data from ${sourcePath} to SQL Server.`);
  for (const [table, count] of Object.entries(counts)) {
    console.log(`${table}: ${count}`);
  }
}

try {
  await migrate();
} finally {
  source.close();
  await pool.close();
}
