import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongodb from 'mongodb';

const { MongoClient } = mongodb;
const { EJSON } = mongodb.BSON;

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = join(root, '.env');
const exportDirectory = join(root, 'data', 'mongodb-export');

try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('Set MONGODB_URI in .env or the process environment before importing.');
}

const files = (await readdir(exportDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
  .sort((left, right) => left.name.localeCompare(right.name));

if (files.length === 0) {
  throw new Error(`No JSON export files found in ${exportDirectory}. Run npm run export:mongodb first.`);
}

const collections = [];
for (const file of files) {
  const filePath = join(exportDirectory, file.name);
  let documents;
  try {
    documents = EJSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse MongoDB Extended JSON in ${file.name}: ${error.message}`, { cause: error });
  }

  if (!Array.isArray(documents)) {
    throw new Error(`${file.name} must contain a JSON array.`);
  }
  if (documents.some(document => !document || typeof document !== 'object' || Array.isArray(document) || !('_id' in document))) {
    throw new Error(`${file.name} contains a document without a valid _id.`);
  }

  collections.push({ name: file.name.slice(0, -'.json'.length), documents });
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const database = client.db(process.env.MONGODB_DATABASE || 'bkspacetech_cms');

  for (const { name, documents } of collections) {
    const collection = database.collection(name);
    for (let offset = 0; offset < documents.length; offset += 500) {
      const batch = documents.slice(offset, offset + 500);
      await collection.bulkWrite(
        batch.map(document => ({
          replaceOne: {
            filter: { _id: document._id },
            replacement: document,
            upsert: true
          }
        })),
        { ordered: true }
      );
    }
    console.log(`${name}: imported ${documents.length} document(s)`);
  }
  console.log(`Import complete: ${collections.length} collection(s) into ${database.databaseName}.`);
} finally {
  await client.close();
}
