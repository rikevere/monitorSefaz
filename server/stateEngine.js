'use strict';

/**
 * Reproduz a legenda oficial do Portal da NF-e (página "Consultar
 * Disponibilidade"):
 *
 *  VERDE   - a consulta retornou resposta positiva. Ocorre após qualquer estágio.
 *  AMARELO - primeira resposta negativa (falta de serviço ou falha de conexão).
 *            Ocorre após o Verde e permanece por até 10 minutos.
 *            Uma resposta positiva volta para Verde; respostas negativas
 *            contínuas evoluem para Vermelho ao final do prazo.
 *  VERMELHO- respostas negativas seguidas, após o Amarelo. Uma resposta
 *            positiva a qualquer momento retoma o Verde.
 */

const AMARELO_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos, igual ao portal oficial

class StateEngine {
  constructor() {
    /** @type {Map<string, {color: string, since: number, lastOkAt: number|null, lastCheckAt: number|null}>} */
    this.states = new Map();
  }

  _get(key) {
    if (!this.states.has(key)) {
      this.states.set(key, { color: 'cinza', since: Date.now(), lastOkAt: null, lastCheckAt: null });
    }
    return this.states.get(key);
  }

  /**
   * Registra o resultado de uma consulta (ok=true/false) e devolve o novo estado.
   */
  registrar(key, ok) {
    const now = Date.now();
    const s = this._get(key);
    s.lastCheckAt = now;

    if (ok) {
      s.lastOkAt = now;
      if (s.color !== 'verde') {
        s.color = 'verde';
        s.since = now;
      }
      return s.color;
    }

    // Resposta negativa
    if (s.color === 'verde' || s.color === 'cinza') {
      s.color = 'amarelo';
      s.since = now;
    } else if (s.color === 'amarelo') {
      if (now - s.since >= AMARELO_TIMEOUT_MS) {
        s.color = 'vermelho';
        s.since = now;
      }
      // senão permanece amarelo
    }
    // se já está vermelho, permanece vermelho
    return s.color;
  }

  snapshot(key) {
    return { ...this._get(key) };
  }
}

module.exports = { StateEngine, AMARELO_TIMEOUT_MS };
