'use strict';

function buildStatusSnapshot({ ambiente, documentos = {}, totalUfs = 0 }) {
  const docEntries = Object.entries(documentos || {});
  const pending = [];
  let fulfilled = true;

  if (!docEntries.length || totalUfs <= 0) {
    return {
      ok: false,
      ready: false,
      status: 'pending',
      ambiente,
      totalUfs,
      consultadas: 0,
      message: 'Aguardando a primeira conclusão da consulta de todas as UFs monitoradas.',
    };
  }

  for (const [docKey, doc] of docEntries) {
    const ufs = Array.isArray(doc && doc.ufs) ? doc.ufs : [];

    if (ufs.length !== totalUfs) {
      fulfilled = false;
      pending.push(`${docKey}: ${ufs.length}/${totalUfs} UFs consultadas`);
      continue;
    }

    for (const item of ufs) {
      if (!item || item.ok !== true) {
        fulfilled = false;
        pending.push(`${docKey}: UF ${item && item.uf ? item.uf : '?'} sem resposta válida`);
      }
    }
  }

  return {
    ok: fulfilled,
    ready: fulfilled,
    status: fulfilled ? 'ready' : 'pending',
    ambiente,
    totalUfs,
    consultadas: docEntries.reduce((sum, [, doc]) => sum + (Array.isArray(doc && doc.ufs) ? doc.ufs.length : 0), 0),
    message: fulfilled
      ? 'Consulta concluída com sucesso para todas as UFs monitoradas.'
      : pending.length
        ? `Consulta pendente: ${pending.join('; ')}`
        : 'Aguardando consulta de todas as UFs monitoradas.',
  };
}

module.exports = { buildStatusSnapshot };
