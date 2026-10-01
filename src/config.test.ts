import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('retorna defaults locais com env vazio', () => {
    const cfg = parseConfig({});
    expect(cfg).toEqual({
      host: '127.0.0.1',
      port: 3001,
      databasePath: './data/bank.sqlite',
      frontendOrigin: 'http://127.0.0.1:3000',
      cookieSecure: false,
      logLevel: 'info',
      workerPollIntervalMs: 200,
      testControls: { enabled: false, token: '' },
    });
  });

  it('aplica overrides de cada variável', () => {
    const cfg = parseConfig({
      HOST: '0.0.0.0',
      PORT: '4000',
      DATABASE_PATH: './data/outro.sqlite',
      FRONTEND_ORIGIN: 'https://app.exemplo.com',
      COOKIE_SECURE: 'true',
      LOG_LEVEL: 'debug',
      WORKER_POLL_INTERVAL_MS: '500',
      ENABLE_TEST_CONTROLS: 'true',
      TEST_CONTROL_TOKEN: '0123456789abcdef',
    });
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.port).toBe(4000);
    expect(cfg.databasePath).toBe('./data/outro.sqlite');
    expect(cfg.frontendOrigin).toBe('https://app.exemplo.com');
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.workerPollIntervalMs).toBe(500);
    expect(cfg.testControls).toEqual({ enabled: true, token: '0123456789abcdef' });
  });

  it('rejeita porta inválida', () => {
    expect(() => parseConfig({ PORT: 'abc' })).toThrowError(/PORT/);
    expect(() => parseConfig({ PORT: '0' })).toThrowError(/PORT/);
    expect(() => parseConfig({ PORT: '70000' })).toThrowError(/PORT/);
    expect(() => parseConfig({ PORT: '3.5' })).toThrowError(/PORT/);
  });

  it('rejeita DATABASE_PATH :memory: e vazio', () => {
    expect(() => parseConfig({ DATABASE_PATH: ':memory:' })).toThrowError(/DATABASE_PATH/);
    expect(() => parseConfig({ DATABASE_PATH: '   ' })).toThrowError(/DATABASE_PATH/);
  });

  it('rejeita origin com path', () => {
    expect(() => parseConfig({ FRONTEND_ORIGIN: 'http://127.0.0.1:3000/app' })).toThrowError(
      /FRONTEND_ORIGIN/,
    );
    expect(() => parseConfig({ FRONTEND_ORIGIN: 'notaurl' })).toThrowError(/FRONTEND_ORIGIN/);
  });

  it('rejeita booleano inválido citando a variável', () => {
    expect(() => parseConfig({ COOKIE_SECURE: 'yes' })).toThrowError(/COOKIE_SECURE/);
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: '1' })).toThrowError(/ENABLE_TEST_CONTROLS/);
  });

  it('rejeita flag de teste sem token ou com token curto', () => {
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: 'true' })).toThrowError(/TEST_CONTROL_TOKEN/);
    expect(() =>
      parseConfig({ ENABLE_TEST_CONTROLS: 'true', TEST_CONTROL_TOKEN: 'curto' }),
    ).toThrowError(/TEST_CONTROL_TOKEN/);
  });

  it('reporta múltiplos erros juntos', () => {
    let message = '';
    try {
      parseConfig({ PORT: 'x', COOKIE_SECURE: 'maybe', DATABASE_PATH: ':memory:' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/COOKIE_SECURE/);
    expect(message).toMatch(/DATABASE_PATH/);
  });
});
