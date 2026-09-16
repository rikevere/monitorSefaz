const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStatusSnapshot } = require('../server/snapshotStatus');

test('snapshot só marca sucesso quando todas as UFs tiverem sido consultadas', () => {
  const snapshot = buildStatusSnapshot({
    ambiente: 'producao',
    documentos: {
      nfe: {
        label: 'NF-e',
        ufs: [
          { uf: 'SP', ok: true, estado: { color: 'verde' } },
          { uf: 'RJ', ok: true, estado: { color: 'verde' } },
        ],
      },
    },
    totalUfs: 2,
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.message, 'Consulta concluída com sucesso para todas as UFs monitoradas.');
});

test('snapshot permanece pendente quando ainda faltam UFs no ciclo', () => {
  const snapshot = buildStatusSnapshot({
    ambiente: 'producao',
    documentos: {
      nfe: {
        label: 'NF-e',
        ufs: [
          { uf: 'SP', ok: true, estado: { color: 'verde' } },
        ],
      },
    },
    totalUfs: 2,
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.ready, false);
  assert.match(snapshot.message, /pendente|faltam/i);
});
