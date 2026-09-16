'use strict';

/**
 * Cliente para o webservice "NFeStatusServico4", o mesmo serviço que a NF-e
 * usa para saber se um autorizador está de pé. É o mesmo princípio usado
 * pelo Portal Nacional (disponibilidade.aspx) e por ferramentas como o ACBr.
 *
 * Referência do payload: Nota Técnica NF-e / Manual de Orientação do
 * Contribuinte (MOC) - consulta de status do serviço, mensagem consStatServ.
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const ibgeCodes = require('./config/ibge-codes.json');

const TIMEOUT_MS = 12000;

function normalizeTransportError(err) {
  const source = err && (err.cause || err.reason || err);
  const details = [];

  if (source && source.code) details.push(source.code);
  if (source && source.errno) details.push(`errno=${source.errno}`);
  if (source && source.message) details.push(source.message);
  if (source && source.stack) details.push(source.stack.split('\n')[0]);
  if (err && err.message && err.message !== 'fetch failed' && !details.some((item) => String(item).includes(err.message))) {
    details.push(err.message);
  }

  if (!details.length) return 'Falha de rede/SSL ao consultar o serviço.';
  return details.filter(Boolean).join(' | ');
}

function classifyTransportError(err) {
  const haystack = [
    err && err.message,
    err && err.code,
    err && err.cause && err.cause.code,
    err && err.cause && err.cause.message,
    err && err.errno,
  ].filter(Boolean).join(' ').toLowerCase();

  if (!haystack) return 'unknown';

  const tlsIndicators = [
    'unable_to_get_issuer_cert_locally',
    'unable to get local issuer certificate',
    'self signed certificate',
    'certificate has expired',
    'ssl',
    'tls',
    'handshake',
    'alert certificate',
    'certificate unknown',
    'certificate verify failed',
    'unrecognized name',
  ];

  if (tlsIndicators.some((indicator) => haystack.includes(indicator))) {
    return 'tls';
  }

  if (haystack.includes('timeout') || haystack.includes('econnrefused') || haystack.includes('enotfound') || haystack.includes('ecancelled')) {
    return 'network';
  }

  return 'service';
}

function readCustomCaFromEnv() {
  const candidates = [process.env.SEFAZ_CA_FILE, process.env.NODE_EXTRA_CA_CERTS].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate);
    } catch (_err) {
      // Em ambiente Linux/Windows, a CA pode ser informada pela variável de ambiente
      // ou por um bundle específico. Se o arquivo não existir, segue sem override.
    }
  }
  return null;
}

function isTlsLikeError(err) {
  if (!err) return false;
  const text = [
    err.message,
    err.code,
    err.errno,
    err.cause && err.cause.message,
    err.cause && err.cause.code,
    err.cause && err.cause.errno,
  ].filter(Boolean).join(' ').toLowerCase();

  return [
    'unable_to_get_issuer_cert_locally',
    'unable to get local issuer certificate',
    'self signed certificate',
    'certificate has expired',
    'ssl routines',
    'sslv3 alert bad certificate',
    'alert bad certificate',
    'ssl alert',
    'tls',
    'handshake',
    'certificate unknown',
    'unrecognized name',
    'epk',
    'certificate verify failed',
    'unable to verify the first certificate',
  ].some((indicator) => text.includes(indicator));
}

function buildHttpsAgent(options = {}) {
  const customCa = options.ca || readCustomCaFromEnv();
  const allowLegacyTls = Boolean(options.allowLegacyTls || process.env.SEFAZ_ALLOW_LEGACY_TLS === 'true' || process.env.SEFAZ_ALLOW_LEGACY_TLS === '1');
  const rejectUnauthorized = Object.prototype.hasOwnProperty.call(options, 'rejectUnauthorized')
    ? options.rejectUnauthorized
    : !allowLegacyTls;

  const agentOptions = {
    keepAlive: true,
    rejectUnauthorized,
  };

  if (customCa) {
    agentOptions.ca = customCa;
  }

  if (allowLegacyTls || options.rejectUnauthorized === false) {
    agentOptions.secureOptions =
      crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
      crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION;
    agentOptions.ciphers = 'DEFAULT@SECLEVEL=0';
  }

  return new https.Agent(agentOptions);
}

/**
 * Monta o envelope SOAP 1.2 exigido pelos webservices da NF-e.
 * O nome do elemento de dados e o namespace variam ligeiramente de UF
 * para UF (algumas ainda usam a grafia antiga "NfeStatusServico4"), por
 * isso tentamos, em ordem, as variantes mais comuns.
 */
function buildEnvelope(cUF, ambiente, dadosMsgTag, dadosNamespace, soapVariant = {}) {
  const tpAmb = ambiente === 'homologacao' ? 2 : 1;
  const envelopeLocalName = soapVariant.envelopeLocalName || 'soap12';
  const soapNamespace = soapVariant.soapNamespace || 'http://www.w3.org/2003/05/soap-envelope';

  return `<?xml version="1.0" encoding="UTF-8"?>
<${envelopeLocalName}:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:${envelopeLocalName}="${soapNamespace}">
  <${envelopeLocalName}:Header>
    <nfeCabecMsg xmlns="${dadosNamespace}">
      <cUF>${cUF}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </${envelopeLocalName}:Header>
  <${envelopeLocalName}:Body>
    <${dadosMsgTag} xmlns="${dadosNamespace}">
      <consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <cUF>${cUF}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </${dadosMsgTag}>
  </${envelopeLocalName}:Body>
</${envelopeLocalName}:Envelope>`;
}

// Variantes observadas em produção: alguns autorizadores aceitam SOAP 1.1 e
// outros SOAP 1.2, além de diferenças minúsculas/maiúsculas no namespace.
const NAMESPACE_VARIANTS = [
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    contentType: 'text/xml; charset=utf-8',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    envelopeLocalName: 'soap',
    soapNamespace: 'http://schemas.xmlsoap.org/soap/envelope/',
  },
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4',
    contentType: 'text/xml; charset=utf-8',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4/nfeStatusServicoNF',
    envelopeLocalName: 'soap',
    soapNamespace: 'http://schemas.xmlsoap.org/soap/envelope/',
  },
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    contentType: 'application/soap+xml; charset=utf-8',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    envelopeLocalName: 'soap12',
    soapNamespace: 'http://www.w3.org/2003/05/soap-envelope',
  },
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    contentType: 'text/xml; charset=utf-8',
    soapAction: 'nfeStatusServicoNF',
    envelopeLocalName: 'soap',
    soapNamespace: 'http://schemas.xmlsoap.org/soap/envelope/',
  },
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    contentType: 'application/soap+xml; charset=utf-8',
    soapAction: 'nfeStatusServicoNF',
    envelopeLocalName: 'soap12',
    soapNamespace: 'http://www.w3.org/2003/05/soap-envelope',
  },
  {
    tag: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4',
    contentType: 'application/soap+xml; charset=utf-8',
    soapAction: 'NFeStatusServico4/nfeStatusServicoNF',
    envelopeLocalName: 'soap12',
    soapNamespace: 'http://www.w3.org/2003/05/soap-envelope',
  },
];

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

async function postWithTimeout(url, body, headers, requestOptions = {}) {
  const started = Date.now();
  const parsedUrl = new URL(url);
  const allowLegacyTls = requestOptions.allowLegacyTls ?? (process.env.SEFAZ_ALLOW_LEGACY_TLS === 'true' || process.env.SEFAZ_ALLOW_LEGACY_TLS === '1');
  const rejectUnauthorized = requestOptions.rejectUnauthorized ?? true;
  const agent = buildHttpsAgent({ allowLegacyTls, rejectUnauthorized });

  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request(
        parsedUrl,
        {
          method: 'POST',
          headers,
          agent,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => {
            resolve({
              httpStatus: res.statusCode || 0,
              text,
              latencyMs: Date.now() - started,
            });
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Timeout após ${TIMEOUT_MS}ms`));
      });

      req.on('error', reject);
      req.write(body, 'utf8');
      req.end();
    });

    return response;
  } catch (err) {
    if (isTlsLikeError(err) && rejectUnauthorized) {
      return postWithTimeout(url, body, headers, {
        ...requestOptions,
        allowLegacyTls: true,
        rejectUnauthorized: false,
      });
    }
    throw err;
  }
}

/**
 * Consulta o status de um autorizador. Retorna um objeto normalizado,
 * nunca lança exceção (falhas de rede viram { ok: false }).
 */
async function consultarStatus(uf, endpointUrl, ambiente = 'producao') {
  const cUF = ibgeCodes[uf];
  if (!endpointUrl || !cUF) {
    return { ok: false, error: 'Endpoint ou código IBGE não configurado para esta UF.' };
  }

  let lastError = null;

  for (const variant of NAMESPACE_VARIANTS) {
    const envelope = buildEnvelope(cUF, ambiente, variant.tag, variant.ns, variant);
    const soapAction = variant.soapAction;

    try {
      const { httpStatus, text, latencyMs } = await postWithTimeout(endpointUrl, envelope, {
        'Content-Type': variant.contentType,
        'Accept': 'text/xml, application/soap+xml',
        'SOAPAction': `"${soapAction}"`,
        'User-Agent': 'SEFAZ-Monitor/1.0 (+monitoramento de disponibilidade NF-e)',
      });

      const cStat = extractTag(text, 'cStat');
      const xMotivo = extractTag(text, 'xMotivo');
      const tMed = extractTag(text, 'tMed');
      const dhRecbto = extractTag(text, 'dhRecbto');

      if (cStat) {
        return {
          ok: true,
          httpStatus,
          cStat,
          xMotivo: xMotivo || null,
          tempoMedio: tMed ? Number(tMed) : null,
          dhRecbto,
          latencyMs,
        };
      }

      // Respondeu, mas sem cStat reconhecível: guarda para diagnóstico e tenta a próxima variante.
      lastError = `HTTP ${httpStatus} sem <cStat> reconhecível (namespace ${variant.ns}).`;
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? `Timeout após ${TIMEOUT_MS}ms`
        : normalizeTransportError(err);
    }
  }

  return {
    ok: false,
    error: lastError || 'Falha desconhecida na consulta.',
    transportClass: classifyTransportError(new Error(lastError || 'Falha desconhecida na consulta.')),
  };
}

module.exports = { consultarStatus, normalizeTransportError, classifyTransportError, buildHttpsAgent };
