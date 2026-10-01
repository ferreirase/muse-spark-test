export interface TestControlsConfig {
  enabled: boolean;
  token: string;
}

export interface Config {
  host: string;
  port: number;
  databasePath: string;
  frontendOrigin: string;
  cookieSecure: boolean;
  logLevel: string;
  workerPollIntervalMs: number;
  testControls: TestControlsConfig;
}

export type EnvRecord = Record<string, string | undefined>;

const DEFAULTS: { host: string; port: number; databasePath: string; frontendOrigin: string; cookieSecure: boolean; logLevel: string; workerPollIntervalMs: number } = {
  host: '127.0.0.1',
  port: 3001,
  databasePath: './data/bank.sqlite',
  frontendOrigin: 'http://127.0.0.1:3000',
  cookieSecure: false,
  logLevel: 'info',
  workerPollIntervalMs: 200,
} as const;

function parseBoolean(
  raw: string | undefined,
  name: string,
  def: boolean,
  errors: string[],
): boolean {
  if (raw === undefined || raw === '') return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  errors.push(`${name} deve ser "true" ou "false" (recebido: ${JSON.stringify(raw)})`);
  return def;
}

function hasPathSuffix(url: URL): boolean {
  return url.pathname !== '/' && url.pathname !== '';
}

export function parseConfig(env: EnvRecord): Config {
  const errors: string[] = [];

  const host = env['HOST'] ?? DEFAULTS.host;

  let port = DEFAULTS.port;
  const rawPort = env['PORT'];
  if (rawPort !== undefined && rawPort !== '') {
    const n = Number(rawPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push(`PORT deve ser inteiro entre 1 e 65535 (recebido: ${JSON.stringify(rawPort)})`);
    } else {
      port = n;
    }
  }

  const databasePath = env['DATABASE_PATH'] ?? DEFAULTS.databasePath;
  if (databasePath.trim() === '') {
    errors.push('DATABASE_PATH não pode ser vazio');
  } else if (databasePath === ':memory:') {
    errors.push('DATABASE_PATH não pode ser ":memory:" — use um arquivo configurável');
  }

  const frontendOrigin = env['FRONTEND_ORIGIN'] ?? DEFAULTS.frontendOrigin;
  try {
    const url = new URL(frontendOrigin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(
        `FRONTEND_ORIGIN deve usar http(s) (recebido: ${JSON.stringify(frontendOrigin)})`,
      );
    } else if (hasPathSuffix(url) || url.search !== '' || url.hash !== '') {
      errors.push(
        `FRONTEND_ORIGIN deve ser só origem, sem path/query/hash (recebido: ${JSON.stringify(frontendOrigin)})`,
      );
    }
  } catch {
    errors.push(`FRONTEND_ORIGIN inválida (recebido: ${JSON.stringify(frontendOrigin)})`);
  }

  const cookieSecure = parseBoolean(env['COOKIE_SECURE'], 'COOKIE_SECURE', DEFAULTS.cookieSecure, errors);
  const logLevel = env['LOG_LEVEL'] ?? DEFAULTS.logLevel;

  let workerPollIntervalMs = DEFAULTS.workerPollIntervalMs;
  const rawPoll = env['WORKER_POLL_INTERVAL_MS'];
  if (rawPoll !== undefined && rawPoll !== '') {
    const n = Number(rawPoll);
    if (!Number.isInteger(n) || n <= 0) {
      errors.push(
        `WORKER_POLL_INTERVAL_MS deve ser inteiro positivo (recebido: ${JSON.stringify(rawPoll)})`,
      );
    } else {
      workerPollIntervalMs = n;
    }
  }

  const testControlsEnabled = parseBoolean(
    env['ENABLE_TEST_CONTROLS'],
    'ENABLE_TEST_CONTROLS',
    false,
    errors,
  );
  const testControlToken = env['TEST_CONTROL_TOKEN'] ?? '';
  if (testControlsEnabled && testControlToken.length < 16) {
    errors.push(
      'TEST_CONTROL_TOKEN é obrigatório com ENABLE_TEST_CONTROLS=true e deve ter ao menos 16 caracteres',
    );
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
    testControls: { enabled: testControlsEnabled, token: testControlToken },
  };
}
