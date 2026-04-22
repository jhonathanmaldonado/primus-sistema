// ===== DASHBOARD — PRIMUS =====
// Carrega vendas do Firestore, calcula KPIs e renderiza gráficos com Chart.js

import { listarVendas, ultimaContagem, listarContagens } from './db.js';

// Cache em memória das vendas carregadas (evita consultas repetidas)
let vendasCache = [];
let chartsAtivos = {};

// ===== CONFIGURAÇÃO DE CORES (identidade Primus) =====
const cores = {
  vinho:         '#7C0047',
  vinhoLight:    '#a13376',
  amarelo:       '#FAB900',
  amareloLight:  '#fcd04d',
  verde:         '#1e6641',
  verdeLight:    '#4a9d71',
  azul:          '#1a5276',
  vermelho:      '#b5451b',
  cinza:         '#6b6761',
  paleta: ['#7C0047', '#FAB900', '#1e6641', '#1a5276', '#b5451b', '#a13376', '#4a9d71', '#fcd04d']
};

// ===== FORMATADORES =====
const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const fmtDataCurta = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarDashboard() {
  const container = document.getElementById('dashboard-container');
  if (!container) return;

  container.innerHTML = `
    <div class="filtro-periodo">
      <label>Período:</label>
      <button class="periodo-btn active" data-periodo="7d">7 dias</button>
      <button class="periodo-btn" data-periodo="30d">30 dias</button>
      <button class="periodo-btn" data-periodo="mes">Mês atual</button>
      <button class="periodo-btn" data-periodo="tudo">Tudo</button>
      <div class="periodo-custom">
        <input type="date" id="periodo-de">
        <span>até</span>
        <input type="date" id="periodo-ate">
        <button class="btn btn-ghost btn-sm" id="btn-aplicar-periodo">Aplicar</button>
      </div>
    </div>

    <div id="dash-loading" style="text-align:center;padding:60px">
      <span class="spinner"></span>
      <div style="margin-top:12px;color:var(--cinza-texto);font-size:13px">Carregando dados...</div>
    </div>

    <div id="dash-conteudo" style="display:none">
      <!-- KPIs -->
      <div class="kpi-grid" id="kpi-grid"></div>

      <!-- Gráficos linha 1 -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>📈 Faturamento diário</h3>
            <span class="grafico-sub" id="sub-diario"></span>
          </div>
          <div class="grafico-wrap">
            <canvas id="chart-diario"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🥧 Mix por grupo</h3>
            <span class="grafico-sub" id="sub-grupos"></span>
          </div>
          <div class="grafico-wrap" style="max-height:280px">
            <canvas id="chart-grupos"></canvas>
          </div>
        </div>
      </div>

      <!-- Gráficos linha 2 -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🕐 Vendas por hora</h3>
            <span class="grafico-sub" id="sub-horas"></span>
          </div>
          <div class="grafico-wrap">
            <canvas id="chart-horas"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🏆 Top 10 produtos (por unidades)</h3>
            <span class="grafico-sub" id="sub-produtos"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-produtos"></canvas>
          </div>
        </div>
      </div>

      <!-- Ranking de vendedores -->
      <div class="card">
        <div class="grafico-head">
          <h3>👥 Ranking de vendedores</h3>
          <span class="grafico-sub" id="sub-vendedores"></span>
        </div>
        <div id="ranking-vendedores"></div>
      </div>

      <!-- Operadores separados -->
      <div class="card" id="card-operadores">
        <div class="grafico-head">
          <h3>🖥️ Operadores (caixa/balcão)</h3>
          <span class="grafico-sub">Vendas em nome do caixa, sem vendedor atribuído</span>
        </div>
        <div id="info-operadores"></div>
      </div>
    </div>

    <div id="dash-vazio" style="display:none">
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>Ainda não há dados de vendas</h3>
        <p>Para ver o dashboard, faça o upload do primeiro TXT do PDV na aba <strong>Vendas</strong>.</p>
        <button class="btn btn-primary" onclick="document.getElementById('nav-vendas').click()">
          Ir para Vendas →
        </button>
      </div>
    </div>
  `;

  // Listeners dos botões de período
  container.querySelectorAll('.periodo-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Limpa datas custom
      document.getElementById('periodo-de').value = '';
      document.getElementById('periodo-ate').value = '';
      aplicarPeriodo(btn.dataset.periodo);
    };
  });

  document.getElementById('btn-aplicar-periodo').onclick = () => {
    const de  = document.getElementById('periodo-de').value;
    const ate = document.getElementById('periodo-ate').value;
    if (!de || !ate) { alert('Selecione as duas datas.'); return; }
    container.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('active'));
    aplicarPeriodo('custom', de, ate);
  };

  // Carrega os dados na primeira vez
  await carregarDados();
  aplicarPeriodo('7d');
}

async function carregarDados() {
  try {
    vendasCache = await listarVendas({ limite: 365 });
  } catch (e) {
    console.error('Erro ao carregar vendas:', e);
    vendasCache = [];
  }
  document.getElementById('dash-loading').style.display = 'none';

  if (!vendasCache.length) {
    document.getElementById('dash-vazio').style.display = 'block';
    return;
  }

  document.getElementById('dash-conteudo').style.display = 'block';
}

// ===== FILTRO DE PERÍODO =====
function aplicarPeriodo(tipo, de = null, ate = null) {
  let inicio, fim;
  const hoje = new Date();
  fim = toIso(hoje);

  if (tipo === '7d') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    inicio = toIso(d);
  } else if (tipo === '30d') {
    const d = new Date(); d.setDate(d.getDate() - 29);
    inicio = toIso(d);
  } else if (tipo === 'mes') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    inicio = toIso(d);
  } else if (tipo === 'custom') {
    inicio = de;
    fim = ate;
  } else { // tudo
    inicio = '0000-00-00';
    fim = '9999-99-99';
  }

  const vendasFiltradas = vendasCache.filter(v => v.id >= inicio && v.id <= fim);
  renderizarDashboard(vendasFiltradas);
}

// ===== RENDERIZAÇÃO =====
function renderizarDashboard(vendas) {
  if (!vendas.length) {
    document.getElementById('kpi-grid').innerHTML = `
      <div class="kpi-card" style="grid-column:1/-1;text-align:center;padding:30px">
        <div style="font-size:30px;margin-bottom:10px">📅</div>
        <div class="kpi-label">Sem dados neste período</div>
      </div>`;
    // Limpa gráficos antigos
    Object.values(chartsAtivos).forEach(c => c?.destroy?.());
    chartsAtivos = {};
    document.getElementById('ranking-vendedores').innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados.</p>';
    document.getElementById('info-operadores').innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados.</p>';
    return;
  }

  renderKPIs(vendas);
  renderGraficoDiario(vendas);
  renderGraficoGrupos(vendas);
  renderGraficoHoras(vendas);
  renderGraficoProdutos(vendas);
  renderRankingVendedores(vendas);
  renderOperadores(vendas);
}

// ===== KPIs =====
function renderKPIs(vendas) {
  const totalFat = vendas.reduce((s, v) => s + (v.totais?.total || 0), 0);
  const totalItens = vendas.reduce((s, v) => s + (v.totais?.qtd || 0), 0);
  const ticket = totalItens ? totalFat / totalItens : 0;
  const diasOp = vendas.length;
  const mediaDiaria = diasOp ? totalFat / diasOp : 0;

  // Melhor vendedor do período
  const somaVendedores = {};
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => {
      somaVendedores[vd.nome] = (somaVendedores[vd.nome] || 0) + (vd.total || 0);
    });
  });
  const melhorVend = Object.entries(somaVendedores).sort((a,b) => b[1] - a[1])[0];

  document.getElementById('kpi-grid').innerHTML = `
    <div class="kpi-card vinho">
      <div class="kpi-label">Faturamento</div>
      <div class="kpi-value">${fmtMoeda(totalFat)}</div>
      <div class="kpi-sub">${diasOp} ${diasOp === 1 ? 'dia' : 'dias'} de operação</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ticket Médio</div>
      <div class="kpi-value">${fmtMoeda(ticket)}</div>
      <div class="kpi-sub">por item vendido</div>
    </div>
    <div class="kpi-card verde">
      <div class="kpi-label">Média Diária</div>
      <div class="kpi-value">${fmtMoeda(mediaDiaria)}</div>
      <div class="kpi-sub">faturamento / dia operado</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Itens Vendidos</div>
      <div class="kpi-value">${fmtInt(totalItens)}</div>
      <div class="kpi-sub">quantidade total</div>
    </div>
    <div class="kpi-card vinho" style="grid-column:span 2">
      <div class="kpi-label">🏆 Maior vendedor do período</div>
      <div class="kpi-value small">${melhorVend ? firstName(melhorVend[0]) : '—'}</div>
      <div class="kpi-sub">${melhorVend ? fmtMoeda(melhorVend[1]) : 'sem vendedores no período'}</div>
    </div>
  `;
}

// ===== GRÁFICO: FATURAMENTO DIÁRIO =====
function renderGraficoDiario(vendas) {
  chartsAtivos.diario?.destroy?.();
  const vendasOrd = [...vendas].sort((a, b) => a.id.localeCompare(b.id));
  const labels = vendasOrd.map(v => fmtDataCurta(v.id));
  const valores = vendasOrd.map(v => v.totais?.total || 0);

  const ctx = document.getElementById('chart-diario');
  if (!ctx) return;

  chartsAtivos.diario = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data: valores,
        borderColor: cores.vinho,
        backgroundColor: 'rgba(124, 0, 71, 0.08)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: cores.amarelo,
        pointBorderColor: cores.vinho,
        pointBorderWidth: 2,
        pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => fmtMoeda(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });

  const media = valores.reduce((s,v) => s+v, 0) / (valores.length || 1);
  document.getElementById('sub-diario').textContent = `média: ${fmtMoeda(media)}`;
}

// ===== GRÁFICO: GRUPOS =====
function renderGraficoGrupos(vendas) {
  chartsAtivos.grupos?.destroy?.();
  const soma = {};
  vendas.forEach(v => {
    (v.grupos || []).forEach(g => {
      soma[g.nome] = (soma[g.nome] || 0) + (g.total || 0);
    });
  });
  const entries = Object.entries(soma).sort((a,b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const valores = entries.map(e => e[1]);

  const ctx = document.getElementById('chart-grupos');
  if (!ctx) return;

  chartsAtivos.grupos = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: cores.paleta,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 10, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = valores.reduce((s,v) => s+v, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return `${ctx.label}: ${fmtMoeda(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  document.getElementById('sub-grupos').textContent = `${labels.length} grupos`;
}

// ===== GRÁFICO: HORAS =====
function renderGraficoHoras(vendas) {
  chartsAtivos.horas?.destroy?.();
  // Soma por faixa de hora
  const soma = {};
  vendas.forEach(v => {
    (v.horas || []).forEach(h => {
      // Normaliza a faixa (o PDV usa "ás" ou "às")
      const chave = h.faixa.replace(/\s+/g, ' ').trim();
      if (!soma[chave]) soma[chave] = { total: 0, horaInicio: null };
      soma[chave].total += h.total || 0;
      // Extrai hora para ordenar
      const m = chave.match(/^(\d{1,2}):(\d{2})/);
      if (m) soma[chave].horaInicio = parseInt(m[1]);
    });
  });
  const entries = Object.entries(soma).sort((a,b) => (a[1].horaInicio||0) - (b[1].horaInicio||0));
  const labels = entries.map(e => {
    const m = e[0].match(/^(\d{1,2}):/);
    return m ? m[1] + 'h' : e[0];
  });
  const valores = entries.map(e => e[1].total);

  const ctx = document.getElementById('chart-horas');
  if (!ctx) return;

  chartsAtivos.horas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data: valores,
        backgroundColor: cores.amarelo,
        borderColor: cores.vinho,
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => fmtMoeda(ctx.parsed.y) }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });

  if (entries.length) {
    const pico = entries.slice().sort((a,b) => b[1].total - a[1].total)[0];
    document.getElementById('sub-horas').textContent = `pico: ${pico[0]} (${fmtMoeda(pico[1].total)})`;
  } else {
    document.getElementById('sub-horas').textContent = '';
  }
}

// ===== GRÁFICO: TOP PRODUTOS (por unidades vendidas) =====
function renderGraficoProdutos(vendas) {
  chartsAtivos.produtos?.destroy?.();
  const soma = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      if (!soma[p.nome]) soma[p.nome] = { qtd: 0, total: 0 };
      soma[p.nome].qtd   += p.qtd || 0;
      soma[p.nome].total += p.total || 0;
    });
  });
  const top = Object.entries(soma).sort((a,b) => b[1].qtd - a[1].qtd).slice(0, 10);
  const labels = top.map(e => e[0].length > 28 ? e[0].slice(0,26) + '…' : e[0]);
  const qtds   = top.map(e => e[1].qtd);
  const valores = top.map(e => e[1].total);

  const ctx = document.getElementById('chart-produtos');
  if (!ctx) return;

  chartsAtivos.produtos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades vendidas',
        data: qtds,
        backgroundColor: cores.vinho,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const i = ctx.dataIndex;
              return `${fmtInt(qtds[i])} unidades · ${fmtMoeda(valores[i])}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtInt(v) + ' un',
            precision: 0
          }
        }
      }
    }
  });

  document.getElementById('sub-produtos').textContent = `${Object.keys(soma).length} produtos no total`;
}

// ===== RANKING VENDEDORES =====
function renderRankingVendedores(vendas) {
  const soma = {};
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => {
      if (!soma[vd.nome]) soma[vd.nome] = { total: 0, qtd: 0, dias: 0 };
      soma[vd.nome].total += vd.total || 0;
      soma[vd.nome].qtd   += vd.qtd || 0;
      soma[vd.nome].dias  += 1;
    });
  });
  const ranking = Object.entries(soma)
    .map(([nome, d]) => ({ nome, ...d, media: d.dias ? d.total / d.dias : 0 }))
    .sort((a,b) => b.total - a.total);

  if (!ranking.length) {
    document.getElementById('ranking-vendedores').innerHTML =
      '<p class="text-muted text-center" style="padding:20px">Sem vendedores no período.</p>';
    document.getElementById('sub-vendedores').textContent = '';
    return;
  }

  const maior = ranking[0].total;
  const medalhas = ['🥇', '🥈', '🥉'];

  document.getElementById('ranking-vendedores').innerHTML = ranking.map((v, i) => {
    const pct = maior ? (v.total / maior) * 100 : 0;
    const medal = medalhas[i] || `<span class="pos">#${i + 1}</span>`;
    const ticket = v.qtd ? v.total / v.qtd : 0;
    return `
      <div class="rank-item">
        <div class="rank-pos">${medal}</div>
        <div class="rank-info">
          <div class="rank-nome">${v.nome}</div>
          <div class="rank-meta">
            <span>${fmtInt(v.qtd)} itens</span>
            <span>·</span>
            <span>ticket médio ${fmtMoeda(ticket)}</span>
            <span>·</span>
            <span>${v.dias} ${v.dias === 1 ? 'dia' : 'dias'}</span>
          </div>
          <div class="rank-barra">
            <div class="rank-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="rank-valor">${fmtMoeda(v.total)}</div>
      </div>
    `;
  }).join('');

  document.getElementById('sub-vendedores').textContent = `${ranking.length} vendedores no período`;
}

// ===== OPERADORES =====
function renderOperadores(vendas) {
  const comOperadores = vendas.filter(v => v.operadores);
  if (!comOperadores.length) {
    document.getElementById('card-operadores').style.display = 'none';
    return;
  }

  let totalOp = 0, qtdOp = 0;
  comOperadores.forEach(v => {
    totalOp += v.operadores.total || 0;
    qtdOp   += v.operadores.qtd || 0;
  });
  const ticketOp = qtdOp ? totalOp / qtdOp : 0;

  // Calcula percentual do total geral
  const totalGeral = vendas.reduce((s,v) => s + (v.totais?.total || 0), 0);
  const pctOp = totalGeral ? (totalOp / totalGeral) * 100 : 0;

  document.getElementById('card-operadores').style.display = 'block';
  document.getElementById('info-operadores').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;padding:10px 0">
      <div>
        <div class="kpi-label">Faturamento OPERADORES</div>
        <div class="kpi-value" style="font-size:20px;color:var(--vinho)">${fmtMoeda(totalOp)}</div>
      </div>
      <div>
        <div class="kpi-label">Itens vendidos</div>
        <div class="kpi-value" style="font-size:20px">${fmtInt(qtdOp)}</div>
      </div>
      <div>
        <div class="kpi-label">Ticket médio</div>
        <div class="kpi-value" style="font-size:20px">${fmtMoeda(ticketOp)}</div>
      </div>
      <div>
        <div class="kpi-label">% do faturamento</div>
        <div class="kpi-value" style="font-size:20px">${pctOp.toFixed(1)}%</div>
      </div>
    </div>
  `;
}

// ===== UTILS =====
function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function firstName(nome) {
  const partes = nome.split(/\s+/);
  if (partes.length <= 2) return nome;
  // Pega primeiro + último nome
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

// Exporta função pra recarregar dados quando o usuário subir novo TXT
export async function recarregarDashboard() {
  vendasCache = [];
  await carregarDados();
  // Re-aplica o período atualmente selecionado
  const ativo = document.querySelector('.periodo-btn.active');
  aplicarPeriodo(ativo ? ativo.dataset.periodo : '7d');
}
