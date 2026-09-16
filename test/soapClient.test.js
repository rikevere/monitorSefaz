const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTransportError, classifyTransportError, buildHttpsAgent } = require('../server/soapClient');

test('normalizeTransportError expõe o erro real do TLS/certificado', () => {
  const err = new Error('fetch failed');
  err.cause = {
    code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    message: 'unable to get local issuer certificate',
  };

  const msg = normalizeTransportError(err);
  assert.match(msg, /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|issuer certificate/i);
});

test('classifyTransportError distingue TLS/CA de falha de serviço', () => {
  const tlsErr = new Error('fetch failed');
  tlsErr.cause = { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', message: 'unable to get local issuer certificate' };
  assert.equal(classifyTransportError(tlsErr), 'tls');

  const httpErr = new Error('HTTP 503 sem <cStat> reconhecível');
  assert.equal(classifyTransportError(httpErr), 'service');
});

test('buildHttpsAgent habilita compatibilidade para servidores de TLS legado quando solicitado', () => {
  const agent = buildHttpsAgent({ allowLegacyTls: true });
  assert.equal(agent.options.rejectUnauthorized, false);
  assert.ok(agent.options.secureOptions || agent.options.ciphers || agent.options.minVersion);
});
