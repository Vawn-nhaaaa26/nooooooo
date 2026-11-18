export async function connectToSqlServer(env = process.env) {
  const auth = (env.DB_AUTH || 'sql').toLowerCase();
  if (!['sql', 'windows'].includes(auth)) {
    throw new Error('DB_AUTH must be either "sql" or "windows".');
  }

  const moduleName = auth === 'windows' ? 'mssql/msnodesqlv8.js' : 'mssql';
  const module = await import(moduleName);
  const sqlDriver = module.default || module;
  const server = env.DB_SERVER || 'localhost';
  const instance = env.DB_INSTANCE || '';
  const options = {
    encrypt: env.DB_ENCRYPT === 'true',
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
  };
  const config = {
    server: auth === 'windows' && instance ? `${server}\\${instance}` : server,
    database: env.DB_NAME || 'bkspacetech_cms',
    options,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 }
  };

  if (auth === 'windows') {
    options.trustedConnection = true;
  } else {
    if (env.DB_PORT) config.port = Number(env.DB_PORT);
    if (instance) options.instanceName = instance;
    config.user = env.DB_USER || '';
    config.password = env.DB_PASSWORD || '';
  }

  const pool = new sqlDriver.ConnectionPool(config);
  await pool.connect();
  return { sqlDriver, pool };
}
