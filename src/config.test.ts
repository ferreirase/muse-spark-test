import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('retorna defaults locais com env vazio', () => {
    const c = parseConfig({});
    expect(c).toEqual({
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

  it('aplica override de cada variável', () => {
    const c = parseConfig({
      HOST: '0.0.0.0',
      PORT: '8080',
      DATABASE_PATH: '/tmp/outro.sqlite',
      FRONTEND_ORIGIN: 'http://exemplo.test',
      COOKIE_SECURE: 'true',
      LOG_LEVEL: 'debug',
      WORKER_POLL_INTERVAL_MS: '50',
      ENABLE_TEST_CONTROLS: 'true',
      TEST_CONTROL_TOKEN: 'abcdef1234567890abcdef',
    });
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(8080);
    expect(c.databasePath).toBe('/tmp/outro.sqlite');
    expect(c.frontendOrigin).toBe('http://exemplo.test');
    expect(c.cookieSecure).toBe(true);
    expect(c.logLevel).toBe('debug');
    expect(c.workerPollIntervalMs).toBe(50);
    expect(c.testControls).toEqual({ enabled: true, token: 'abcdef1234567890abcdef' });
  });

  it('rejeita porta inválida citando PORT', () => {
    expect(() => parseConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseConfig({ PORT: '0' })).toThrow(/PORT/);
  });

  it('rejeita DATABASE_PATH vazio ou :memory:', () => {
    expect(() => parseConfig({ DATABASE_PATH: ':memory:' })).toThrow(/DATABASE_PATH/);
    expect(() => parseConfig({ DATABASE_PATH: '' })).toThrow(/DATABASE_PATH/);
  });

  it('rejeita FRONTEND_ORIGIN com path ou inválida', () => {
    expect(() => parseConfig({ FRONTEND_ORIGIN: 'http://x.test/app' })).toThrow(/FRONTEND_ORIGIN/);
    expect(() => parseConfig({ FRONTEND_ORIGIN: 'nao-url' })).toThrow(/FRONTEND_ORIGIN/);
  });

  it('rejeita booleano inválido citando a variável', () => {
    expect(() => parseConfig({ COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: '1' })).toThrow(/ENABLE_TEST_CONTROLS/);
  });

  it('rejeita ENABLE_TEST_CONTROLS=true sem token ou com token curto', () => {
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: 'true' })).toThrow(/TEST_CONTROL_TOKEN/);
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: 'true', TEST_CONTROL_TOKEN: 'curto' })).toThrow(
      /TEST_CONTROL_TOKEN/,
    );
  });

  it('reporta múltiplos erros juntos', () => {
    try {
      parseConfig({ PORT: 'x', DATABASE_PATH: ':memory:', COOKIE_SECURE: 'talvez' });
      expect.unreachable('deveria lançar');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('PORT');
      expect(msg).toContain('DATABASE_PATH');
      expect(msg).toContain('COOKIE_SECURE');
    }
  });
});
