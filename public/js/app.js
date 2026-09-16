(function () {
  'use strict';

  const REGIOES_ORDEM = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
  const POLL_MS = 30 * 1000;

  const state = {
    docAtual: 'nfe',
    snapshot: null,
    history: null,
    historyUf: null,
    historyRange: 'sample',
  };

  const el = {
    regions: document.getElementById('regions'),
    mapWrap: document.getElementById('brazil-map-wrap'),
    mapSelection: document.getElementById('map-selection'),
    summary: document.getElementById('summary-line'),
    updatedAt: document.getElementById('updated-at'),
    envPill: document.getElementById('env-pill'),
    refreshBtn: document.getElementById('refresh-btn'),
    detailPanel: document.getElementById('detail-panel'),
    detailContent: document.getElementById('detail-content'),
    detailClose: document.getElementById('detail-close'),
    historyUf: document.getElementById('history-uf'),
    historyCharts: {
      sample: { canvas: document.getElementById('history-chart-sample'), summary: document.getElementById('history-summary-sample') },
      hour: { canvas: document.getElementById('history-chart-hour'), summary: document.getElementById('history-summary-hour') },
      day: { canvas: document.getElementById('history-chart-day'), summary: document.getElementById('history-summary-day') },
    },
  };

  document.querySelectorAll('.doc-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.doc-tab').forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      state.docAtual = btn.dataset.doc;
      render();
      renderMap();
      renderHistory();
    });
  });

  el.historyUf.addEventListener('change', () => {
    state.historyUf = el.historyUf.value;
    Object.keys(el.historyCharts).forEach((range) => drawHistoryChart(range));
  });

  el.detailClose.addEventListener('click', closeDetail);
  el.refreshBtn.addEventListener('click', async () => {
    el.refreshBtn.classList.add('is-loading');
    try {
      await fetch('/api/refresh', { method: 'POST' });
      await load();
    } finally {
      el.refreshBtn.classList.remove('is-loading');
    }
  });

  function closeDetail() {
    el.detailPanel.classList.remove('is-open');
    el.detailPanel.setAttribute('aria-hidden', 'true');
  }

  function formatDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { hour12: false });
  }

  function corLabel(cor) {
    return { verde: 'Operando', amarelo: 'Instável', vermelho: 'Fora do ar', cinza: 'Sem dados' }[cor] || cor;
  }

  function openDetail(item) {
    const cor = item.estado ? item.estado.color : 'cinza';
    el.detailContent.innerHTML = `
      <span class="detail-state st-${cor}">
        <span class="dot dot-${cor}"></span> ${corLabel(cor)}
      </span>
      <h2>${item.nome}</h2>
      <p class="detail-region">${item.regiao} · autorizador ${item.autorizador || '—'}</p>

      <dl>
        <div class="detail-row"><dt>cStat</dt><dd>${item.cStat || '—'}</dd></div>
        <div class="detail-row"><dt>Motivo</dt><dd>${item.xMotivo || (item.erro || '—')}</dd></div>
        <div class="detail-row"><dt>Tipo da falha</dt><dd>${item.transportClass === 'tls' ? 'TLS/Certificado' : item.transportClass === 'network' ? 'Rede' : item.transportClass === 'service' ? 'Serviço/UF' : 'Desconhecida'}</dd></div>
        <div class="detail-row"><dt>Tempo médio (SEFAZ)</dt><dd>${item.tempoMedioSegundos != null ? item.tempoMedioSegundos + ' s' : '—'}</dd></div>
        <div class="detail-row"><dt>Latência da consulta</dt><dd>${item.latenciaMs != null ? item.latenciaMs + ' ms' : '—'}</dd></div>
        <div class="detail-row"><dt>Última verificação</dt><dd>${formatDataHora(item.estado ? new Date(item.estado.lastCheckAt).toISOString() : null)}</dd></div>
        <div class="detail-row"><dt>Neste estado desde</dt><dd>${formatDataHora(item.estado ? new Date(item.estado.since).toISOString() : null)}</dd></div>
      </dl>

      <p class="detail-endpoint">${item.endpoint || 'endpoint não mapeado'}</p>
    `;
    el.detailPanel.classList.add('is-open');
    el.detailPanel.setAttribute('aria-hidden', 'false');
  }

  function selectUf(uf) {
    const doc = state.snapshot && state.snapshot.documentos[state.docAtual];
    const item = doc && doc.ufs ? doc.ufs.find((entry) => entry.uf === uf) : null;
    if (!item) return;
    state.historyUf = uf;
    el.historyUf.value = uf;
    renderMap();
    Object.keys(el.historyCharts).forEach((range) => drawHistoryChart(range));
    openDetail(item);
  }

  function renderMap() {
    const doc = state.snapshot && state.snapshot.documentos[state.docAtual];
    if (!doc || !el.mapWrap) return;
    const items = new Map(doc.ufs.map((item) => [item.uf.toLowerCase(), item]));
    const paths = el.mapWrap.querySelectorAll('[data-uf]');
    paths.forEach((path) => {
      const item = items.get(path.dataset.uf);
      const color = item && item.estado ? item.estado.color : 'cinza';
      path.classList.remove('map-verde', 'map-amarelo', 'map-vermelho', 'map-cinza', 'is-selected');
      path.classList.add(`map-${color}`);
      if (item && item.uf === state.historyUf) path.classList.add('is-selected');
      const title = path.querySelector('title') || document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = item ? `${item.uf} · ${item.nome} · ${item.latenciaMs != null ? item.latenciaMs + ' ms' : item.xMotivo || item.erro || 'sem dados'}` : 'Sem dados';
      if (!title.parentNode) path.prepend(title);
      const label = el.mapWrap.querySelector(`[data-map-label="${path.dataset.uf}"]`);
      if (label) {
        const value = item && item.latenciaMs != null ? `${item.latenciaMs} ms` : item && item.cStat ? item.cStat : '—';
        label.querySelector('.map-label-uf').textContent = item ? item.uf : path.dataset.uf.toUpperCase();
        label.querySelector('.map-label-value').textContent = value;
      }
    });
    el.mapSelection.textContent = state.historyUf ? `UF selecionada: ${state.historyUf}` : 'Clique em um estado para ver os detalhes.';
  }

  async function loadMap() {
    try {
      const response = await fetch('/vendor/svg-maps-brazil/brazil.svg');
      if (!response.ok) throw new Error('map request failed');
      const text = await response.text();
      const source = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      const map = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      map.setAttribute('viewBox', source.getAttribute('viewBox') || '0 0 613 639');
      map.setAttribute('role', 'img');
      map.setAttribute('aria-label', 'Mapa do Brasil com disponibilidade por estado');
      map.classList.add('brazil-map');
      el.mapWrap.replaceChildren(map);
      source.querySelectorAll('path').forEach((sourcePath) => {
        const path = sourcePath.cloneNode(true);
        path.dataset.uf = (sourcePath.id || '').toLowerCase();
        path.addEventListener('click', () => selectUf(path.dataset.uf.toUpperCase()));
        path.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') selectUf(path.dataset.uf.toUpperCase());
        });
        path.setAttribute('tabindex', '0');
        path.setAttribute('role', 'button');
        map.appendChild(path);
        const box = path.getBBox();
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.dataset.mapLabel = path.dataset.uf;
        label.setAttribute('x', box.x + box.width / 2);
        label.setAttribute('y', box.y + box.height / 2 - 4);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('pointer-events', 'none');
        label.classList.add('map-label');
        const ufText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        ufText.classList.add('map-label-uf');
        ufText.setAttribute('x', box.x + box.width / 2);
        ufText.textContent = path.dataset.uf.toUpperCase();
        const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        valueText.classList.add('map-label-value');
        valueText.setAttribute('x', box.x + box.width / 2);
        valueText.setAttribute('dy', '12');
        valueText.textContent = '—';
        label.append(ufText, valueText);
        map.appendChild(label);
      });
      renderMap();
    } catch (error) {
      el.mapWrap.innerHTML = '<p class="map-loading">Mapa indisponível. Os cards por UF continuam disponíveis abaixo.</p>';
    }
  }

  function render() {
    const doc = state.snapshot && state.snapshot.documentos[state.docAtual];
    el.envPill.textContent = 'ambiente · ' + (state.snapshot ? state.snapshot.ambiente : '—');

    if (state.snapshot && state.snapshot.ready === false) {
      el.summary.textContent = state.snapshot.message || 'Aguardando a conclusão da consulta de todas as UFs monitoradas…';
      if (el.regions) el.regions.innerHTML = '';
      return;
    }

    if (!el.regions) return;

    if (!doc || !doc.ufs || !doc.ufs.length) {
      el.summary.textContent = 'Aguardando a primeira verificação dos autorizadores…';
      el.regions.innerHTML = '';
      return;
    }

    const counts = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 };
    doc.ufs.forEach((u) => {
      const cor = (u.estado && u.estado.color) || 'cinza';
      counts[cor] = (counts[cor] || 0) + 1;
    });

    el.summary.innerHTML = `<strong>${doc.ufs.length}</strong> autorizadores de ${doc.label} ·
      <span class="n-verde">${counts.verde} operando</span> ·
      <span class="n-amarelo">${counts.amarelo} instáveis</span> ·
      <span class="n-vermelho">${counts.vermelho} fora do ar</span>`;

    const porRegiao = {};
    doc.ufs.forEach((u) => {
      (porRegiao[u.regiao] = porRegiao[u.regiao] || []).push(u);
    });

    el.regions.innerHTML = '';
    REGIOES_ORDEM.forEach((regiao) => {
      const itens = porRegiao[regiao];
      if (!itens) return;
      itens.sort((a, b) => a.uf.localeCompare(b.uf));

      const block = document.createElement('div');
      block.className = 'region-block';

      const title = document.createElement('p');
      title.className = 'region-title';
      title.textContent = regiao;
      block.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'uf-grid';

      itens.forEach((item) => {
        const cor = (item.estado && item.estado.color) || 'cinza';
        const tile = document.createElement('button');
        tile.className = 'uf-tile';
        tile.innerHTML = `
          <div class="uf-tile-top">
            <span class="uf-sigla">${item.uf}</span>
            <span class="dot dot-${cor}"></span>
          </div>
          <span class="uf-nome">${item.nome}</span>
          <span class="uf-meta">${item.latenciaMs != null ? item.latenciaMs + ' ms' : (item.cStat || '—')}</span>
        `;
        tile.addEventListener('click', () => selectUf(item.uf));
        grid.appendChild(tile);
      });

      block.appendChild(grid);
      el.regions.appendChild(block);
    });
  }

  function renderHistory() {
    const doc = state.snapshot && state.snapshot.documentos[state.docAtual];
    const ufs = doc && doc.ufs ? doc.ufs.map((item) => item.uf).sort() : [];
    if (!ufs.includes(state.historyUf)) state.historyUf = ufs[0] || null;
    el.historyUf.innerHTML = ufs.map((uf) => `<option value="${uf}">${uf}</option>`).join('');
    el.historyUf.value = state.historyUf || '';
    Object.keys(el.historyCharts).forEach((range) => drawHistoryChart(range));
  }

  function drawHistoryChart(range) {
    const chart = el.historyCharts[range];
    const canvas = chart.canvas;
    const summary = chart.summary;
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const days = state.history && state.history.days ? state.history.days : {};
    const samples = Object.values(days).flatMap((day) => day.samples || []);
    const rawPoints = samples.map((sample) => ({
      timestamp: sample.timestamp,
      entry: sample.documents && sample.documents[state.docAtual] ? sample.documents[state.docAtual][state.historyUf] : null,
    }));
    const points = aggregatePoints(rawPoints, range, state.history.intervalMs || 180000);
    const valid = points.filter((point) => Number.isFinite(point.value) || point.classification === 'Erro');

    const padding = { top: 10, right: 8, bottom: range === 'sample' ? 58 : 34, left: 112 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const bandHeight = chartHeight / 5;
    const barWidth = Math.max(2, (chartWidth / Math.max(points.length, 1)) * 0.78);
    const x = (index) => padding.left + barWidth / 2 + (points.length <= 1 ? (chartWidth - barWidth) / 2 : (index / (points.length - 1)) * (chartWidth - barWidth));
    const y = (value) => {
      if (!Number.isFinite(value)) return padding.top;
      if (value <= 2000) return padding.top + chartHeight - bandHeight * (value / 2000);
      if (value <= 5000) return padding.top + chartHeight - bandHeight - bandHeight * ((value - 2000) / 3000);
      if (value < 30000) return padding.top + chartHeight - (bandHeight * 2) - bandHeight * ((value - 5000) / 25000);
      return padding.top + chartHeight - (bandHeight * 3) - bandHeight * Math.min(1, (value - 30000) / 30000);
    };

    context.strokeStyle = '#24404b';
    context.fillStyle = '#a2aab4';
    context.font = '11px IBM Plex Mono, monospace';
    context.textAlign = 'right';
    for (let band = 0; band < 5; band += 1) {
      context.fillStyle = band % 2 === 0 ? 'rgba(36, 64, 75, 0.16)' : 'rgba(11, 18, 21, 0.12)';
      context.fillRect(padding.left, padding.top + band * bandHeight, chartWidth, bandHeight);
    }
    context.fillStyle = '#a2aab4';
    const scaleLabels = [
      { label: 'Erro', lineY: padding.top },
      { label: 'Timeout: > 30s', lineY: padding.top + bandHeight },
      { label: 'Muito lento: < 30s', lineY: padding.top + bandHeight * 2 },
      { label: 'Lento: <= 5s', lineY: padding.top + bandHeight * 3 },
      { label: 'Normal: <= 2s', lineY: padding.top + bandHeight * 4 },
    ];
    scaleLabels.forEach(({ label, lineY }) => {
      context.beginPath();
      context.moveTo(padding.left, lineY);
      context.lineTo(width - padding.right, lineY);
      context.stroke();
      context.fillText(label, padding.left - 8, lineY + 4);
    });

    const colors = { Normal: '#9dff22', Lento: '#f2b84b', 'Muito Lento': '#f47732', Erro: '#ef476f', Timeout: '#a4aec2' };
    const barTop = {
      Normal: padding.top + bandHeight * 4,
      Lento: padding.top + bandHeight * 3,
      'Muito Lento': padding.top + bandHeight * 2,
      Timeout: padding.top + bandHeight,
      Erro: padding.top,
    };
    points.forEach((point, index) => {
      if (!point.classification) return;
      const top = barTop[point.classification];
      if (top == null) return;
      context.fillStyle = colors[point.classification];
      context.fillRect(x(index) - barWidth / 2, top, barWidth, padding.top + chartHeight - top);
    });

    context.fillStyle = '#a2aab4';
    context.font = '10px IBM Plex Mono, monospace';
    context.textAlign = 'center';
    const labelStep = 1;
    points.forEach((point, index) => {
      if (!point.label || index % labelStep !== 0) return;
      context.save();
      if (range === 'day' || range === 'sample') {
        context.translate(x(index), height - 8);
        context.rotate(-Math.PI / 4);
        context.fillText(point.label, 0, 0);
      } else {
        context.fillText(point.label, x(index), height - 10);
      }
      context.restore();
    });

    const first = new Date(points[0].timestamp);
    const last = new Date(points[points.length - 1].timestamp);
    summary.textContent = valid.length
      ? `${state.historyUf} · ${valid.length} registros · ${formatDataHora(first.toISOString())} a ${formatDataHora(last.toISOString())}`
      : `${state.historyUf} · aguardando registros no período`;
  }

  function dateKey(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
  }

  function aggregatePoints(points, range, intervalMs) {
    const now = new Date();
    if (range === 'sample') {
      const latestTimestamp = points.length
        ? Math.max(...points.map((point) => new Date(point.timestamp).getTime()))
        : now.getTime();
      const end = Math.floor(latestTimestamp / intervalMs) * intervalMs;
      const start = end - (30 - 1) * intervalMs;
      const slots = new Map();
      for (let timestamp = start; timestamp <= end; timestamp += intervalMs) slots.set(timestamp, { timestamp: new Date(timestamp).toISOString(), entry: null });
      points.forEach((point) => {
        const timestamp = Math.floor(new Date(point.timestamp).getTime() / intervalMs) * intervalMs;
        if (slots.has(timestamp)) slots.get(timestamp).entry = point.entry;
      });
      return [...slots.values()].map((point) => ({ ...point, label: new Date(point.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), value: point.entry ? point.entry.latencyMs : null, classification: point.entry ? point.entry.classification : null }));
    }

    const today = dateKey(now);
    const groups = new Map();
    if (range === 'hour') {
      for (let hour = 0; hour < 24; hour += 1) {
        const key = `${today}T${String(hour).padStart(2, '0')}:00:00`;
        groups.set(key, { timestamp: new Date(`${key}-03:00`).toISOString(), label: String(hour).padStart(2, '0'), values: [], counts: {} });
      }
    } else {
      const [year, month] = (state.history.month || today.slice(0, 7)).split('-').map(Number);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= lastDay; day += 1) {
        const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (key > today) break;
        groups.set(key, { timestamp: new Date(`${key}T00:00:00-03:00`).toISOString(), label: String(day).padStart(2, '0'), values: [], counts: {} });
      }
    }
    points.forEach((point) => {
      const date = new Date(point.timestamp);
      const hourText = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(date);
      const hour = hourText === '24' ? '00' : hourText;
      const key = range === 'hour'
        ? `${dateKey(date)}T${hour}:00:00`
        : dateKey(date);
      const group = groups.get(key);
      if (!group) return;
      if (point.entry && Number.isFinite(point.entry.latencyMs)) {
        group.values.push(point.entry.latencyMs);
        group.counts[point.entry.classification] = (group.counts[point.entry.classification] || 0) + 1;
      } else if (point.entry) {
        group.counts[point.entry.classification || 'Erro'] = (group.counts[point.entry.classification || 'Erro'] || 0) + 1;
      }
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((group) => {
      const classification = Object.entries(group.counts).sort((a, b) => b[1] - a[1])[0];
      return { timestamp: group.timestamp, label: group.label, value: group.values.length ? group.values.reduce((sum, value) => sum + value, 0) / group.values.length : null, classification: classification ? classification[0] : null };
    });
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('history request failed');
      state.history = await res.json();
      renderHistory();
    } catch (err) {
      Object.values(el.historyCharts).forEach((chart) => { chart.summary.textContent = 'Não foi possível carregar o histórico mensal.'; });
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/status');
      state.snapshot = await res.json();
      el.updatedAt.textContent = state.snapshot.atualizadoEm
        ? 'última atualização · ' + formatDataHora(state.snapshot.atualizadoEm)
        : 'aguardando primeira verificação';
      render();
      renderMap();
      await loadHistory();
    } catch (err) {
      el.summary.textContent = 'Não foi possível falar com o servidor local (/api/status). Verifique se o servidor Node está rodando.';
    }
  }

  load();
  loadMap();
  setInterval(load, POLL_MS);
  window.addEventListener('resize', () => {
    if (!state.history) return;
    Object.keys(el.historyCharts).forEach((range) => drawHistoryChart(range));
  });
})();
