'use strict';

const fs = require('fs');
const path = require('path');

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((values, part) => {
    if (part.type !== 'literal') values[part.type] = part.value;
    return values;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthInTimeZone(date, timeZone) {
  return dateInTimeZone(date, timeZone).slice(0, 7);
}

function emptyHistory(month, intervalMs) {
  return { month, updatedAt: null, intervalMs, days: {} };
}

class HistoryStore {
  constructor({ dataDir = path.join(__dirname, '..', 'data'), timeZone = 'America/Sao_Paulo' } = {}) {
    this.dataDir = dataDir;
    this.timeZone = timeZone;
    this.data = null;
  }

  async _load(month, intervalMs) {
    if (this.data && this.data.month === month) return;
    const filePath = path.join(this.dataDir, `status-history-${month}.json`);
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      this.data = parsed.month === month ? { ...emptyHistory(month, intervalMs), ...parsed, intervalMs } : emptyHistory(month, intervalMs);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.data = emptyHistory(month, intervalMs);
    }
  }

  async _save() {
    const filePath = path.join(this.dataDir, `status-history-${this.data.month}.json`);
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await fs.promises.rename(temporaryPath, filePath);
  }

  async append(documents, intervalMs, collectedAt = new Date()) {
    const date = dateInTimeZone(collectedAt, this.timeZone);
    const month = monthInTimeZone(collectedAt, this.timeZone);
    await this._load(month, intervalMs);
    if (!this.data.days[date]) this.data.days[date] = { samples: [] };
    const sample = { timestamp: collectedAt.toISOString(), documents: {} };

    for (const [docKey, document] of Object.entries(documents || {})) {
      sample.documents[docKey] = {};
      for (const item of document.ufs || []) {
        sample.documents[docKey][item.uf] = {
          ok: item.ok === true,
          color: item.estado ? item.estado.color : 'cinza',
          cStat: item.cStat || null,
          latencyMs: Number.isFinite(item.latenciaMs) ? item.latenciaMs : null,
          classification: classifyLatency(item.latenciaMs, item.erro, item.transportClass),
          source: item.source || 'SOAP',
        };
      }
    }

    this.data.days[date].samples.push(sample);
    this.data.updatedAt = collectedAt.toISOString();
    await this._save();
    return this.data;
  }

  async read(intervalMs) {
    await this._load(monthInTimeZone(new Date(), this.timeZone), intervalMs);
    return this.data;
  }
}

function classifyLatency(latencyMs, error, transportClass) {
  if (Number.isFinite(latencyMs)) {
    if (latencyMs <= 2000) return 'Normal';
    if (latencyMs <= 5000) return 'Lento';
    if (latencyMs < 30000) return 'Muito Lento';
    return 'Timeout';
  }
  if (transportClass === 'network' && /timeout/i.test(error || '')) return 'Timeout';
  return 'Erro';
}

module.exports = { HistoryStore, dateInTimeZone, monthInTimeZone, classifyLatency };