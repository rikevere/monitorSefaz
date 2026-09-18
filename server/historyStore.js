'use strict';

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

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

function jsonValue(value) {
  return value === null || value === undefined ? null : value;
}

class HistoryStore {
  constructor({ dataDir = path.join(__dirname, '..', 'data'), timeZone = 'America/Sao_Paulo' } = {}) {
    this.dataDir = dataDir;
    this.timeZone = timeZone;
    this.dbPath = path.join(dataDir, 'monitor-sefaz.sqlite');
    this.db = null;
    this.initPromise = this._initialize();
  }

  async _initialize() {
    await fs.promises.mkdir(path.dirname(this.dbPath), { recursive: true });
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file),
    });
    const existing = await fs.promises.readFile(this.dbPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    this.db = existing ? new SQL.Database(existing) : new SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS readings (
        collected_at TEXT NOT NULL,
        month TEXT NOT NULL,
        day TEXT NOT NULL,
        document TEXT NOT NULL,
        uf TEXT NOT NULL,
        ok INTEGER NOT NULL,
        color TEXT NOT NULL,
        c_stat TEXT,
        latency_ms INTEGER,
        classification TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (collected_at, document, uf)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        month TEXT PRIMARY KEY,
        updated_at TEXT,
        interval_ms INTEGER NOT NULL
      );
    `);
    await this._importLegacyJson();
    await this._save();
  }

  async _importLegacyJson() {
    const files = await fs.promises.readdir(this.dataDir);
    const jsonFiles = files.filter((file) => /^status-history-\d{4}-\d{2}\.json$/.test(file));
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO readings
        (collected_at, month, day, document, uf, ok, color, c_stat, latency_ms, classification, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const metadata = this.db.prepare('INSERT OR IGNORE INTO metadata (month, updated_at, interval_ms) VALUES (?, ?, ?)');

    try {
      for (const file of jsonFiles) {
        const parsed = JSON.parse(await fs.promises.readFile(path.join(this.dataDir, file), 'utf8'));
        if (!parsed.month || !parsed.days) continue;
        metadata.run([parsed.month, parsed.updatedAt || null, Number(parsed.intervalMs) || 0]);
        for (const [day, dayData] of Object.entries(parsed.days)) {
          for (const sample of dayData.samples || []) {
            for (const [document, ufs] of Object.entries(sample.documents || {})) {
              for (const [uf, item] of Object.entries(ufs || {})) {
                insert.run([
                  sample.timestamp,
                  parsed.month,
                  day,
                  document,
                  uf,
                  item.ok === true ? 1 : 0,
                  item.color || 'cinza',
                  jsonValue(item.cStat),
                  Number.isFinite(item.latencyMs) ? item.latencyMs : null,
                  item.classification || 'Erro',
                  item.source || 'SOAP',
                ]);
              }
            }
          }
        }
      }
    } finally {
      insert.free();
      metadata.free();
    }
  }

  async _save() {
    const bytes = this.db.export();
    await fs.promises.writeFile(this.dbPath, Buffer.from(bytes));
  }

  async append(documents, intervalMs, collectedAt = new Date()) {
    await this.initPromise;
    const timestamp = collectedAt.toISOString();
    const date = dateInTimeZone(collectedAt, this.timeZone);
    const month = monthInTimeZone(collectedAt, this.timeZone);
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO readings
        (collected_at, month, day, document, uf, ok, color, c_stat, latency_ms, classification, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      for (const [docKey, document] of Object.entries(documents || {})) {
        for (const item of document.ufs || []) {
          insert.run([
            timestamp,
            month,
            date,
            docKey,
            item.uf,
            item.ok === true ? 1 : 0,
            item.estado ? item.estado.color : 'cinza',
            jsonValue(item.cStat),
            Number.isFinite(item.latenciaMs) ? item.latenciaMs : null,
            classifyLatency(item.latenciaMs, item.erro, item.transportClass),
            item.source || 'SOAP',
          ]);
        }
      }
      this.db.run(
        'INSERT OR REPLACE INTO metadata (month, updated_at, interval_ms) VALUES (?, ?, ?)',
        [month, timestamp, intervalMs],
      );
    } finally {
      insert.free();
    }

    await this._save();
    return this._readMonth(month, intervalMs);
  }

  _readMonth(month, intervalMs) {
    const result = this.db.exec(`
      SELECT collected_at, day, document, uf, ok, color, c_stat, latency_ms, classification, source
      FROM readings
      WHERE month = ?
      ORDER BY collected_at, document, uf
    `, [month]);
    const metadata = this.db.exec('SELECT updated_at, interval_ms FROM metadata WHERE month = ?', [month]);
    const history = emptyHistory(month, metadata.length ? metadata[0].values[0][1] : intervalMs);
    history.updatedAt = metadata.length ? metadata[0].values[0][0] : null;
    const rows = result.length ? result[0].values : [];

    for (const [timestamp, day, document, uf, ok, color, cStat, latencyMs, classification, source] of rows) {
      if (!history.days[day]) history.days[day] = { samples: [] };
      let sample = history.days[day].samples.find((entry) => entry.timestamp === timestamp);
      if (!sample) {
        sample = { timestamp, documents: {} };
        history.days[day].samples.push(sample);
      }
      if (!sample.documents[document]) sample.documents[document] = {};
      sample.documents[document][uf] = {
        ok: ok === 1,
        color,
        cStat,
        latencyMs,
        classification,
        source,
      };
    }
    return history;
  }

  async read(intervalMs) {
    await this.initPromise;
    return this._readMonth(monthInTimeZone(new Date(), this.timeZone), intervalMs);
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
