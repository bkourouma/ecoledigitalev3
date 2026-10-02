process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-only-jwt-secret-0123456789abcdef';

import Fastify, { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { filesRoutes } from '../routes/files';
import { socialLoginAuthorized } from '../routes/auth';
import authMiddleware from '../plugins/auth-middleware';

// SEC-03 : les routes legacy /api/v1/files/* sont sans JWT pour les GET ; aucun segment ne doit pouvoir sortir du dossier.
describe('files routes : traversée de chemin', () => {
  let app: FastifyInstance;
  const secretName = 'sec03-secret.txt';
  const secretPath = path.join(process.cwd(), secretName);

  beforeAll(async () => {
    await fs.writeFile(secretPath, 'TOP-SECRET-SEC03');
    app = Fastify({ logger: false });
    await app.register(filesRoutes, { prefix: '/api/v1/files' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await fs.unlink(secretPath).catch(() => undefined);
  });

  const up = '..%2F..%2F..%2F';
  it.each([
    `/api/v1/files/t1/c1/submissions/${up}${secretName}`,
    `/api/v1/files/t1/c1/${up}${secretName}`,
    `/api/v1/files/..%2F../c1/${secretName}`,
    `/api/v1/files/download/t1/c1/${up}${secretName}`,
    `/api/v1/files/t1/report-cards/${up}${secretName}`,
    `/api/v1/files/t1/transcripts/${up}${secretName}`,
    `/api/v1/files/receipts/${up}${secretName}`,
    `/api/v1/files/serve-file?tenantId=..&courseId=..&filename=${secretName}`,
  ])('refuse %s', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: { 'x-tenant': 't1', 'x-user-id': 'u' } });
    expect(res.body).not.toContain('TOP-SECRET-SEC03');
    expect(res.statusCode).not.toBe(200);
  });
});

describe('SEC-04 : écriture sur /api/v1/files exige un JWT', () => {
  it('POST /upload sans jeton -> 401 même avec x-tenant / x-user-id forgés', async () => {
    const app = Fastify({ logger: false });
    await app.register(authMiddleware);
    await app.register(filesRoutes, { prefix: '/api/v1/files' });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      headers: { 'x-tenant': 't1', 'x-user-id': 'u', 'content-type': 'application/json' },
      payload: { assignmentId: '22a57716-1b30-4567-8234-f03f28d5ebbf' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('SEC-05 : /auth/social-login sans secret partagé', () => {
  const req = { headers: {} as Record<string, unknown> };
  it.each([undefined, 'staging', 'production', ''])('refusé si NODE_ENV=%s', (nodeEnv) => {
    expect(socialLoginAuthorized(req, { NODE_ENV: nodeEnv })).toBe(false);
  });
  it('toléré seulement en development / test explicites', () => {
    expect(socialLoginAuthorized(req, { NODE_ENV: 'development' })).toBe(true);
    expect(socialLoginAuthorized(req, { NODE_ENV: 'test' })).toBe(true);
  });
  it('avec secret : comparaison exacte', () => {
    const env = { NODE_ENV: 'production', AUTH_SOCIAL_SHARED_SECRET: 's'.repeat(40) };
    expect(socialLoginAuthorized({ headers: { 'x-social-login-secret': 's'.repeat(40) } }, env)).toBe(true);
    expect(socialLoginAuthorized({ headers: { 'x-social-login-secret': 't'.repeat(40) } }, env)).toBe(false);
    expect(socialLoginAuthorized(req, env)).toBe(false);
  });
});
