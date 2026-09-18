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

test('persiste coletas no SQLite e mantém os dias do histórico', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sefaz-history-'));
  const store = new HistoryStore({ dataDir: folder, timeZone: 'America/Sao_Paulo' });
  const documents = {
    nfe: {
      ufs: [{ uf: 'SP', ok: true, cStat: '107', latenciaMs: 240, estado: { color: 'verde' } }],
    },
  };

  await store.append(documents, 180000, new Date('2026-09-16T12:00:00Z'));
  await store.append(documents, 180000, new Date('2026-09-16T12:03:00Z'));
  let history = await store._readMonth('2026-09', 180000);
  assert.equal(history.month, '2026-09');
  assert.equal(history.days['2026-09-16'].samples.length, 2);
  assert.equal(history.days['2026-09-16'].samples[0].documents.nfe.SP.latencyMs, 240);
  assert.equal(history.days['2026-09-16'].samples[0].documents.nfe.SP.classification, 'Normal');

  await store.append(documents, 180000, new Date('2026-09-17T12:00:00Z'));
  history = await store._readMonth('2026-09', 180000);
  assert.equal(history.month, '2026-09');
  assert.equal(history.days['2026-09-17'].samples.length, 1);
  assert.equal(fs.existsSync(path.join(folder, 'monitor-sefaz.sqlite')), true);

  fs.rmSync(folder, { recursive: true, force: true });
});

test('importa o JSON legado apenas uma vez', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sefaz-history-import-'));
  const legacy = {
    month: '2026-09',
    updatedAt: '2026-09-18T12:00:00.000Z',
    intervalMs: 180000,
    days: { '2026-09-18': { samples: [{
      timestamp: '2026-09-18T12:00:00.000Z',
      documents: { nfe: { SP: { ok: true, color: 'verde', cStat: '107', latencyMs: 100, classification: 'Normal', source: 'SOAP' } } },
    }] } },
  };
  fs.writeFileSync(path.join(folder, 'status-history-2026-09.json'), JSON.stringify(legacy));
  const first = new HistoryStore({ dataDir: folder, timeZone: 'America/Sao_Paulo' });
  await first.initPromise;
  assert.equal((await first._readMonth('2026-09', 180000)).days['2026-09-18'].samples.length, 1);
  const second = new HistoryStore({ dataDir: folder, timeZone: 'America/Sao_Paulo' });
  await second.initPromise;
  assert.equal((await second._readMonth('2026-09', 180000)).days['2026-09-18'].samples.length, 1);
  fs.rmSync(folder, { recursive: true, force: true });
});