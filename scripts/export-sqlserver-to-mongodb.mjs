import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToSqlServer } from '../database/connect.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, 'data', 'mongodb-export');
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
const jsonFields = {
  audit_logs: { details_json: 'details' },
  cms_state: { state_json: 'state' },
  revisions: { snapshot_json: 'snapshot' }
};

try {
  const env = readFileSync(join(root, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function mongoValue(value) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === 'bigint') return { $numberLong: value.toString() };
  return value;
}

function mongoDocument(table, row) {
  const keys = primaryKeys[table];
  const key = keys.map(column => String(row[column])).join(':');
  const document = { _id: key };
  for (const [column, value] of Object.entries(row)) {
    const mongoColumn = jsonFields[table]?.[column];
    if (mongoColumn && typeof value === 'string') {
      try {
        document[mongoColumn] = JSON.parse(value);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        console.warn(`Keeping ${table}.${column} as text for row ${key}: invalid JSON.`);
        document[column] = value;
      }
    } else {
      document[column] = mongoValue(value);
    }
  }
  return document;
}

const { pool } = await connectToSqlServer(process.env);
try {
  await mkdir(outputDirectory, { recursive: true });
  for (const table of Object.keys(primaryKeys)) {
    const result = await pool.request().query(`SELECT * FROM dbo.[${table}]`);
    const documents = result.recordset.map(row => mongoDocument(table, row));
    const outputPath = join(outputDirectory, `${table}.json`);
    await writeFile(outputPath, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
    console.log(`${table}: exported ${documents.length} document(s) to ${outputPath}`);
  }
  console.log('Export complete. Files use MongoDB Extended JSON and can be imported with mongoimport --jsonArray.');
} finally {
  await pool.close();
}
