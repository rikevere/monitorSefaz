'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { HistoryStore, classifyLatency } = require('../server/historyStore');

test('classifica os limites de tempo da coleta', () => {
  assert.equal(classifyLatency(2000), 'Normal');
  assert.equal(classifyLatency(2001), 'Lento');
  assert.equal(classifyLatency(5000), 'Lento');
  assert.equal(classifyLatency(5001), 'Muito Lento');
  assert.equal(classifyLatency(29999), 'Muito Lento');
  assert.equal(classifyLatency(30000), 'Timeout');
  assert.equal(classifyLatency(null, 'sem retorno', 'service'), 'Erro');
});

test('persiste coletas do dia e inicia novo arquivo no dia seguinte', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sefaz-history-'));
  const store = new HistoryStore({ dataDir: folder, timeZone: 'America/Sao_Paulo' });
  const documents = {
    nfe: {
      ufs: [{ uf: 'SP', ok: true, cStat: '107', latenciaMs: 240, estado: { color: 'verde' } }],
    },
  };

  await store.append(documents, 180000, new Date('2026-09-16T12:00:00Z'));
  await store.append(documents, 180000, new Date('2026-09-16T12:03:00Z'));
  const filePath = path.join(folder, 'status-history-2026-09.json');
  let history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(history.month, '2026-09');
  assert.equal(history.days['2026-09-16'].samples.length, 2);
  assert.equal(history.days['2026-09-16'].samples[0].documents.nfe.SP.latencyMs, 240);
  assert.equal(history.days['2026-09-16'].samples[0].documents.nfe.SP.classification, 'Normal');

  await store.append(documents, 180000, new Date('2026-09-17T12:00:00Z'));
  history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(history.month, '2026-09');
  assert.equal(history.days['2026-09-17'].samples.length, 1);

  fs.rmSync(folder, { recursive: true, force: true });
});