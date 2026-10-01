export interface Config {
  host: string;
  port: number;
  databasePath: string;
  frontendOrigin: string;
  cookieSecure: boolean;
  logLevel: string;
  workerPollIntervalMs: number;
  testControls: { enabled: boolean; token: string };
}

const BOOLEANS = ['COOKIE_SECURE', 'ENABLE_TEST_CONTROLS'] as const;

function parseBoolean(name: string, raw: string | undefined, errors: string[], fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  errors.push(`${name}=${raw} inválido (use true|false)`);
  return fallback;
}

function parseOrigin(raw: string | undefined, errors: string[], fallback: string): string {
  if (raw === undefined || raw === '') return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`FRONTEND_ORIGIN=${raw} não é uma URL válida`);
    return fallback;
  }
  if (!/^https?:$/.test(url.protocol)) {
    errors.push(`FRONTEND_ORIGIN deve usar http ou https`);
    return fallback;
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    errors.push(`FRONTEND_ORIGIN não pode ter path/query/fragment (recebi ${raw})`);
    return fallback;
  }
  return raw;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const errors: string[] = [];

  const host = env.HOST?.trim() || '127.0.0.1';

  let port = 3001;
  if (env.PORT !== undefined && env.PORT !== '') {
    const n = Number(env.PORT);
    if (!/^\d+$/.test(env.PORT) || !Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push(`PORT=${env.PORT} inválido (inteiro 1–65535)`);
    } else {
      port = n;
    }
  }

  const databasePath = env.DATABASE_PATH === undefined ? './data/bank.sqlite' : env.DATABASE_PATH.trim();
  if (databasePath === '' || databasePath === ':memory:') {
    errors.push(`DATABASE_PATH não pode ser vazio nem :memory: na execução do app`);
  }

  const frontendOrigin = parseOrigin(env.FRONTEND_ORIGIN, errors, 'http://127.0.0.1:3000');

  const cookieSecure = parseBoolean('COOKIE_SECURE', env.COOKIE_SECURE, errors, false);

  const logLevel = env.LOG_LEVEL?.trim() || 'info';

  let workerPollIntervalMs = 200;
  if (env.WORKER_POLL_INTERVAL_MS !== undefined && env.WORKER_POLL_INTERVAL_MS !== '') {
    const n = Number(env.WORKER_POLL_INTERVAL_MS);
    if (!/^\d+$/.test(env.WORKER_POLL_INTERVAL_MS) || n < 1) {
      errors.push(`WORKER_POLL_INTERVAL_MS=${env.WORKER_POLL_INTERVAL_MS} inválido (inteiro >= 1)`);
    } else {
      workerPollIntervalMs = n;
    }
  }

  const enabled = parseBoolean('ENABLE_TEST_CONTROLS', env.ENABLE_TEST_CONTROLS, errors, false);
  const token = env.TEST_CONTROL_TOKEN ?? '';
  if (enabled && token.trim().length < 16) {
    errors.push(`ENABLE_TEST_CONTROLS=true exige TEST_CONTROL_TOKEN com pelo menos 16 caracteres`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuração inválida:\n- ${errors.join('\n- ')}`);
  }

  return {
    host,
    port,
    databasePath,
    frontendOrigin,
    cookieSecure,
    logLevel,
    workerPollIntervalMs,
    testControls: { enabled, token: token.trim() },
  };
}

/** Carrega .env (se existir) e retorna a config do processo. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  try {
    (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
  } catch {
    // .env ausente ou ilegível: usa só o ambiente real
  }
  return parseConfig(env);
}
