'use strict';

const path = require('path');
const express = require('express');
require('dotenv').config();

const { consultarStatus } = require('./soapClient');
const { consultarDisponibilidadePortal } = require('./portalAvailability');
const { StateEngine } = require('./stateEngine');
const { buildStatusSnapshot } = require('./snapshotStatus');
const { HistoryStore } = require('./historyStore');

const endpointsNFe = require('./config/endpoints-nfe.json');
const endpointsNFCe = require('./config/endpoints-nfce.json');
const ufMeta = require('./config/uf-meta.json');

const PORT = process.env.PORT || 3000;
const AMBIENTE = process.env.SEFAZ_AMBIENTE === 'homologacao' ? 'homologacao' : 'producao';
const INTERVALO_MS = Number(process.env.CHECK_INTERVAL_MS || 3 * 60 * 1000); // 3 min, como os monitores do mercado
const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY || 6);
const HISTORY_TIME_ZONE = process.env.SEFAZ_HISTORY_TIME_ZONE || 'America/Sao_Paulo';

const UFS = Object.keys(ufMeta);
const DOCUMENTOS = {
  nfe: { label: 'NF-e', endpoints: endpointsNFe },
  nfce: { label: 'NFC-e', endpoints: endpointsNFCe },
};
const PORTAL_URL = 'https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx';
const PORTAL_FALLBACK = process.env.SEFAZ_PORTAL_FALLBACK !== 'false';

const engine = new StateEngine();
const historyStore = new HistoryStore({ timeZone: HISTORY_TIME_ZONE });

/** Snapshot em memória, servido pela API. */
const snapshot = {
  atualizadoEm: null,
  ambiente: AMBIENTE,
  documentos: {},
  ok: false,
  ready: false,
  status: 'pending',
  totalUfs: UFS.length,
  consultadas: 0,
  message: 'Aguardando consulta de todas as UFs monitoradas.',
};

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function checarUF(docKey, uf) {
  const endpoints = DOCUMENTOS[docKey].endpoints;
  const entry = endpoints[uf];
  const url = entry && entry.statusServico && entry.statusServico[AMBIENTE];
  const key = `${docKey}:${uf}`;

  if (!url) {
    engine.registrar(key, false);
    return {
      uf,
      nome: ufMeta[uf].nome,
      regiao: ufMeta[uf].regiao,
      autorizador: entry ? entry.autorizador : null,
      ok: false,
      erro: 'Endpoint não mapeado para esta UF/ambiente.',
      transportClass: 'service',
      estado: engine.snapshot(key),
    };
  }

  const resultado = await consultarStatus(uf, url, AMBIENTE);
  const operando = resultado.ok && resultado.cStat === '107';
  const cor = engine.registrar(key, operando);

  return {
    uf,
    nome: ufMeta[uf].nome,
    regiao: ufMeta[uf].regiao,
    autorizador: entry.autorizador,
    ok: resultado.ok,
    cStat: resultado.cStat || null,
    xMotivo: resultado.xMotivo || null,
    tempoMedioSegundos: resultado.tempoMedio,
    latenciaMs: resultado.latencyMs,
    erro: resultado.ok ? null : resultado.error,
    transportClass: resultado.transportClass || 'service',
    estado: { ...engine.snapshot(key), color: cor },
    endpoint: url,
  };
}

async function checarDocumento(docKey) {
  let portalAvailability = null;
  if (PORTAL_FALLBACK && AMBIENTE === 'producao') {
    try {
      portalAvailability = await consultarDisponibilidadePortal();
      console.log(`[sefaz-monitor] Fallback oficial do Portal Nacional ativo para ${Object.keys(portalAvailability).length} autorizadores.`);
    } catch (err) {
      console.error('[sefaz-monitor] Fallback do Portal Nacional indisponível:', err.message);
    }
  }

  const resultados = [];
  for (const grupo of chunk(UFS, CONCURRENCY)) {
    const parciais = await Promise.all(grupo.map(async (uf) => {
      const entry = DOCUMENTOS[docKey].endpoints[uf];
      const portal = portalAvailability && entry && portalAvailability[entry.autorizador];
      if (portal) {
        const key = `${docKey}:${uf}`;
        const color = engine.registrar(key, portal.ok);
        return {
          uf,
          nome: ufMeta[uf].nome,
          regiao: ufMeta[uf].regiao,
          autorizador: entry.autorizador,
          ok: portal.ok,
          cStat: portal.ok ? '107' : null,
          xMotivo: portal.ok ? 'Serviço em operação (Portal Nacional)' : 'Indisponibilidade informada pelo Portal Nacional',
          tempoMedioSegundos: null,
          latenciaMs: portal.latencyMs,
          erro: portal.ok ? null : 'Portal Nacional informa indisponibilidade.',
          transportClass: 'portal',
          source: 'Portal Nacional',
          sourceCheckedAt: portal.checkedAt,
          estado: { ...engine.snapshot(key), color },
          endpoint: PORTAL_URL,
        };
      }
      return checarUF(docKey, uf);
    }));
    resultados.push(...parciais);
  }
  return resultados;
}

async function ciclo() {
  for (const docKey of Object.keys(DOCUMENTOS)) {
    try {
      const resultados = await checarDocumento(docKey);
      snapshot.documentos[docKey] = {
        label: DOCUMENTOS[docKey].label,
        ufs: resultados,
      };
    } catch (err) {
      console.error(`[sefaz-monitor] Falha ao checar ${docKey}:`, err);
    }
  }

  Object.assign(
    snapshot,
    buildStatusSnapshot({
      ambiente: AMBIENTE,
      documentos: snapshot.documentos,
      totalUfs: UFS.length,
    }),
    {
      atualizadoEm: new Date().toISOString(),
    },
  );

  try {
    await historyStore.append(snapshot.documentos, INTERVALO_MS, new Date());
  } catch (err) {
    console.error('[sefaz-monitor] Falha ao persistir histórico diário:', err.message);
  }

  console.log(`[sefaz-monitor] Ciclo concluído em ${snapshot.atualizadoEm} | ready=${snapshot.ready} | ok=${snapshot.ok}`);
}

let cicloEmAndamento = null;
let ultimoCicloIniciadoEm = 0;
function dispararCiclo() {
  if (cicloEmAndamento) return cicloEmAndamento;
  ultimoCicloIniciadoEm = Date.now();
  cicloEmAndamento = ciclo().finally(() => {
    cicloEmAndamento = null;
  });
  return cicloEmAndamento;
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/svg-maps-brazil', express.static(path.join(__dirname, '..', 'node_modules', '@svg-maps', 'brazil')));

app.get('/api/status', (req, res) => {
  res.json(snapshot);
});

app.get('/api/history', async (req, res) => {
  try {
    res.json(await historyStore.read(INTERVALO_MS));
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível ler o histórico diário.' });
  }
});

app.post('/api/refresh', async (req, res) => {
  const decorridoMs = Date.now() - ultimoCicloIniciadoEm;
  if (ultimoCicloIniciadoEm && decorridoMs < INTERVALO_MS) {
    const retryAfterSeconds = Math.ceil((INTERVALO_MS - decorridoMs) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      ...snapshot,
      message: `Aguarde ${retryAfterSeconds}s antes da próxima consulta.`,
      retryAfterSeconds,
    });
    return;
  }
  await dispararCiclo();
  res.json(snapshot);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptimeSeconds: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`[sefaz-monitor] Servidor no ar em http://localhost:${PORT}`);
  console.log(`[sefaz-monitor] Ambiente monitorado: ${AMBIENTE}`);
  dispararCiclo();
  setInterval(dispararCiclo, INTERVALO_MS);
});
