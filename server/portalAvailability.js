'use strict';

const https = require('https');

const PORTAL_URL = 'https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx';

function getPortalHtml(url = PORTAL_URL, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) {
      reject(new Error('Redirecionamentos demais ao consultar o Portal Nacional.'));
      return;
    }

    const request = (rejectUnauthorized) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'SEFAZ-Monitor/1.0',
          Cookie: 'AspxAutoDetectCookieSupport=1',
        },
        rejectUnauthorized,
        timeout: 12000,
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            getPortalHtml(new URL(res.headers.location, url).toString(), redirects + 1)
              .then(resolve)
              .catch(reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Portal Nacional respondeu HTTP ${res.statusCode}`));
            return;
          }
          resolve(body);
        });
      });

      req.on('timeout', () => req.destroy(new Error('Timeout ao consultar o Portal Nacional')));
      req.on('error', (error) => {
        if (rejectUnauthorized && /certificate|ssl|tls/i.test(`${error.code || ''} ${error.message || ''}`)) {
          request(false);
          return;
        }
        reject(error);
      });
    };

    request(true);
  });
}

function parsePortalAvailability(html) {
  const result = {};
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 6) continue;

    const autorizador = cells[0].replace(/<[^>]+>/g, '').trim();
    if (!/^(?:[A-Z]{2}|SVAN|SVRS|SVC-AN|SVC-RS)$/.test(autorizador)) continue;

    const serviceCell = cells[5].toLowerCase();
    const image = serviceCell.match(/src=['"][^'"]*bola_(verde|amarela|vermelho)[^'"]*['"]/i);
    const color = image ? image[1].toLowerCase() : 'desconhecido';
    result[autorizador] = {
      ok: color === 'verde',
      color,
      checkedAt: new Date().toISOString(),
    };
  }

  return result;
}

async function consultarDisponibilidadePortal() {
  const started = Date.now();
  const html = await getPortalHtml();
  const availability = parsePortalAvailability(html);
  if (!Object.keys(availability).length) {
    throw new Error('Portal Nacional não retornou a tabela de disponibilidade.');
  }
  const latencyMs = Date.now() - started;
  return Object.fromEntries(Object.entries(availability).map(([key, value]) => [key, { ...value, latencyMs }]));
}

module.exports = { consultarDisponibilidadePortal, parsePortalAvailability };