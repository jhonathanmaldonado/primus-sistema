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

      <!-- Gráficos linha 1: faturamento diário + mix subgrupos -->
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
            <h3>🥧 Mix por subgrupo</h3>
            <span class="grafico-sub" id="sub-grupos"></span>
          </div>
          <div class="grafico-wrap" style="max-height:320px">
            <canvas id="chart-grupos"></canvas>
          </div>
        </div>
      </div>

      <!-- Gráficos linha 2: horas + top 10 produtos -->
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

      <!-- Gráficos linha 3: top pratos + ranking entradas -->
      <div class="graficos-grid">
        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🍽️ Top 10 pratos (REFEIÇÕES)</h3>
            <span class="grafico-sub" id="sub-pratos"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-pratos"></canvas>
          </div>
        </div>

        <div class="card grafico-card">
          <div class="grafico-head">
            <h3>🥗 Ranking vendedor × entradas</h3>
            <span class="grafico-sub" id="sub-entradas"></span>
          </div>
          <div class="grafico-wrap" style="height:340px">
            <canvas id="chart-entradas"></canvas>
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

      <!-- Explorador de dados (filtros avançados) -->
      <div class="card" id="card-explorador">
        <div class="grafico-head">
          <h3>🔎 Explorador de dados</h3>
          <span class="grafico-sub">Filtre por data, vendedor, grupo ou produto</span>
        </div>

        <div class="explorador-filtros">
          <div class="filtro-group">
            <label>Dimensão</label>
            <select id="expl-dimensao">
              <option value="vendedor">Por vendedor</option>
              <option value="grupo">Por grupo</option>
              <option value="subgrupo">Por subgrupo</option>
              <option value="produto">Por produto</option>
              <option value="hora">Por hora</option>
              <option value="dia">Por dia</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar vendedor</label>
            <select id="expl-vendedor">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar subgrupo</label>
            <select id="expl-subgrupo">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="filtro-group">
            <label>Filtrar produto</label>
            <select id="expl-produto">
              <option value="">Todos</option>
            </select>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-expl-limpar">Limpar</button>
        </div>

        <div id="explorador-resultado"></div>
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
    document.getElementById('explorador-resultado').innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados.</p>';
    return;
  }

  renderKPIs(vendas);
  renderGraficoDiario(vendas);
  renderGraficoGrupos(vendas);
  renderGraficoHoras(vendas);
  renderGraficoProdutos(vendas);
  renderGraficoPratos(vendas);
  renderGraficoEntradas(vendas);
  renderRankingVendedores(vendas);
  renderExplorador(vendas);
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

// ===== GRÁFICO: MIX POR SUBGRUPO (top 8 + Outros) =====
function renderGraficoGrupos(vendas) {
  chartsAtivos.grupos?.destroy?.();
  const soma = {};
  vendas.forEach(v => {
    (v.subgrupos || []).forEach(s => {
      soma[s.nome] = (soma[s.nome] || 0) + (s.total || 0);
    });
  });
  // Fallback se não tiver subgrupos (dados antigos): usa grupos
  if (Object.keys(soma).length === 0) {
    vendas.forEach(v => {
      (v.grupos || []).forEach(g => {
        soma[g.nome] = (soma[g.nome] || 0) + (g.total || 0);
      });
    });
  }

  const entries = Object.entries(soma).sort((a,b) => b[1] - a[1]);
  // Top 8 + "Outros" agregando o resto
  let top = entries.slice(0, 8);
  const resto = entries.slice(8);
  if (resto.length > 0) {
    const somaResto = resto.reduce((s, e) => s + e[1], 0);
    top.push([`Outros (${resto.length})`, somaResto]);
  }
  const labels = top.map(e => e[0]);
  const valores = top.map(e => e[1]);

  // Paleta estendida pra 9 fatias
  const paletaExpandida = [
    '#7C0047', '#FAB900', '#1e6641', '#1a5276', '#b5451b',
    '#a13376', '#4a9d71', '#fcd04d', '#6b6761'
  ];

  const ctx = document.getElementById('chart-grupos');
  if (!ctx) return;

  chartsAtivos.grupos = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: paletaExpandida.slice(0, labels.length),
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
          labels: {
            boxWidth: 10,
            padding: 8,
            font: { size: 10 },
            generateLabels: function(chart) {
              const data = chart.data;
              if (!data.labels.length) return [];
              const total = data.datasets[0].data.reduce((s,v) => s+v, 0);
              return data.labels.map((label, i) => {
                const v = data.datasets[0].data[i];
                const pct = ((v / total) * 100).toFixed(1);
                const nomeCurto = label.length > 18 ? label.slice(0, 16) + '…' : label;
                return {
                  text: `${nomeCurto} (${pct}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  index: i
                };
              });
            }
          }
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

  document.getElementById('sub-grupos').textContent = `${entries.length} subgrupos`;
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

// ===== GRÁFICO: TOP 10 PRATOS (grupo REFEIÇÕES) =====
// Busca produtos que pertencem ao grupo REFEIÇÕES.
// Como o TXT do PDV não diz explicitamente qual grupo um produto pertence,
// uso heurística: se o produto NÃO aparece em grupos tipo BEBIDAS/DIVERSOS
// e está entre os produtos do dia, consideramos refeição.
// Na prática, identifico os produtos de refeições cruzando com os subgrupos
// que claramente não são bebidas.
function renderGraficoPratos(vendas) {
  chartsAtivos.pratos?.destroy?.();

  // Subgrupos que NÃO são refeições (bebidas e afins) — esses serão excluídos
  const naoRefeicao = new Set([
    'CERVEJAS', 'REFRIGERANTES E SUCOS', 'CAFE ESPRESSO', 'DOSES', 'DRINKS',
    'DIVERSOS', 'SOBREMESAS', 'SORVETES'
  ]);

  // Mapa produto → subgrupo (preenchemos heurística abaixo)
  // Como o TXT lista SUBGRUPO e PRODUTO separadamente, sem dizer qual produto
  // pertence a qual subgrupo, uso uma regra: se o produto tem palavras de
  // comida (PEIXADA, FILE, COSTELINHA, PASTEL, etc), é refeição.
  const palavrasRefeicao = [
    'PEIXADA', 'MOJICA', 'VENTRECHA', 'PINTADO', 'TAMBATINGA', 'MOQUECA',
    'FILE', 'COMBINADO', 'KIDS', 'PARMEGIANA', 'PETISCO', 'PASTEL', 'BOLINHO',
    'CALDO', 'BATATA FRITA', 'FRANGO', 'PICADINHO', 'PALITO', 'COSTELINHA',
    'INDIVIDUAL', 'MIX', 'PIRAO'
  ];

  const soma = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      const nomeUp = p.nome.toUpperCase();
      const ehRefeicao = palavrasRefeicao.some(palavra => nomeUp.includes(palavra));
      if (ehRefeicao) {
        if (!soma[p.nome]) soma[p.nome] = { qtd: 0, total: 0 };
        soma[p.nome].qtd   += p.qtd || 0;
        soma[p.nome].total += p.total || 0;
      }
    });
  });

  const top = Object.entries(soma).sort((a,b) => b[1].qtd - a[1].qtd).slice(0, 10);

  if (!top.length) {
    document.getElementById('sub-pratos').textContent = 'sem dados de pratos no período';
    const ctx = document.getElementById('chart-pratos');
    if (ctx) {
      const ctx2d = ctx.getContext('2d');
      ctx2d.clearRect(0, 0, ctx.width, ctx.height);
    }
    return;
  }

  const labels = top.map(e => e[0].length > 28 ? e[0].slice(0,26) + '…' : e[0]);
  const qtds   = top.map(e => e[1].qtd);
  const valores = top.map(e => e[1].total);

  const ctx = document.getElementById('chart-pratos');
  if (!ctx) return;

  chartsAtivos.pratos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Unidades vendidas',
        data: qtds,
        backgroundColor: cores.amarelo,
        borderColor: cores.vinho,
        borderWidth: 1,
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

  const totalPratos = qtds.reduce((s,v) => s+v, 0);
  document.getElementById('sub-pratos').textContent = `${Object.keys(soma).length} pratos · ${fmtInt(totalPratos)} unid. no top 10`;
}

// ===== GRÁFICO: RANKING VENDEDOR × ENTRADAS =====
// Mostra quantas entradas cada vendedor vendeu (do subgrupo ENTRADAS).
// Como o TXT não associa diretamente produto→vendedor, usamos proxy:
// calculamos o % que ENTRADAS representa do faturamento total do dia,
// e aplicamos a mesma proporção ao faturamento de cada vendedor.
// Não é perfeito mas é a melhor aproximação possível com os dados disponíveis.
//
// Alternativa: se um dia o PDV fornecer "vendedor × produto", usamos isso direto.
function renderGraficoEntradas(vendas) {
  chartsAtivos.entradas?.destroy?.();

  // Calcula para cada dia: unidades totais de ENTRADAS / total de itens
  // E soma por vendedor usando essa proporção
  const somaVend = {};

  vendas.forEach(v => {
    // Acha o subgrupo ENTRADAS do dia
    const entradasDia = (v.subgrupos || []).find(s =>
      s.nome.toUpperCase() === 'ENTRADAS'
    );
    if (!entradasDia) return;

    const totalItensDia = v.totais?.qtd || 0;
    if (!totalItensDia) return;

    const proporcao = entradasDia.qtd / totalItensDia;

    // Aplica a proporção sobre os itens de cada vendedor
    (v.vendedores || []).forEach(vd => {
      const entradasEstimadas = (vd.qtd || 0) * proporcao;
      const valorEstimado = (vd.total || 0) * (entradasDia.total / (v.totais?.total || 1));
      if (!somaVend[vd.nome]) somaVend[vd.nome] = { qtd: 0, total: 0 };
      somaVend[vd.nome].qtd   += entradasEstimadas;
      somaVend[vd.nome].total += valorEstimado;
    });
  });

  const entries = Object.entries(somaVend)
    .filter(e => e[1].qtd > 0)
    .sort((a,b) => b[1].qtd - a[1].qtd)
    .slice(0, 10);

  if (!entries.length) {
    document.getElementById('sub-entradas').textContent = 'sem dados de entradas no período';
    const ctx = document.getElementById('chart-entradas');
    if (ctx) {
      const ctx2d = ctx.getContext('2d');
      ctx2d.clearRect(0, 0, ctx.width, ctx.height);
    }
    return;
  }

  const labels = entries.map(e => firstName(e[0]));
  const qtds   = entries.map(e => Math.round(e[1].qtd));
  const valores = entries.map(e => e[1].total);

  const ctx = document.getElementById('chart-entradas');
  if (!ctx) return;

  chartsAtivos.entradas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Entradas (estimado)',
        data: qtds,
        backgroundColor: cores.verde,
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
            title: ctx => entries[ctx[0].dataIndex][0],
            label: ctx => {
              const i = ctx.dataIndex;
              return `~${fmtInt(qtds[i])} entradas · ${fmtMoeda(valores[i])} (estimado)`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtInt(v),
            precision: 0
          }
        }
      }
    }
  });

  document.getElementById('sub-entradas').textContent = `valores estimados por proporção`;
}

// ===== EXPLORADOR DE DADOS =====
let vendasExploradorAtual = [];

function renderExplorador(vendas) {
  vendasExploradorAtual = vendas;

  // Popula dropdowns de filtro
  const vendedores = new Set();
  const subgrupos = new Set();
  const produtos = new Set();
  vendas.forEach(v => {
    (v.vendedores || []).forEach(vd => vendedores.add(vd.nome));
    (v.subgrupos || []).forEach(s => subgrupos.add(s.nome));
    (v.produtos || []).forEach(p => produtos.add(p.nome));
  });

  popularDropdown('expl-vendedor', vendedores, 'Todos');
  popularDropdown('expl-subgrupo', subgrupos, 'Todos');
  popularDropdown('expl-produto', produtos, 'Todos');

  // Listeners
  ['expl-dimensao', 'expl-vendedor', 'expl-subgrupo', 'expl-produto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = atualizarExplorador;
  });

  const btnLimpar = document.getElementById('btn-expl-limpar');
  if (btnLimpar) {
    btnLimpar.onclick = () => {
      document.getElementById('expl-vendedor').value = '';
      document.getElementById('expl-subgrupo').value = '';
      document.getElementById('expl-produto').value = '';
      atualizarExplorador();
    };
  }

  atualizarExplorador();
}

function popularDropdown(id, items, todosLabel) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const arr = [...items].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = `<option value="">${todosLabel}</option>` +
    arr.map(x => `<option value="${x}">${x}</option>`).join('');
}

function atualizarExplorador() {
  const vendas = vendasExploradorAtual;
  const dimensao   = document.getElementById('expl-dimensao').value;
  const fVend      = document.getElementById('expl-vendedor').value;
  const fSubgrupo  = document.getElementById('expl-subgrupo').value;
  const fProduto   = document.getElementById('expl-produto').value;

  const resultado = document.getElementById('explorador-resultado');

  // Agrupa conforme a dimensão escolhida, aplicando os filtros
  const buckets = {}; // { chave: { qtd, total, dias: Set } }

  vendas.forEach(v => {
    const dataDia = v.id;
    let fonte;

    if (dimensao === 'vendedor') {
      fonte = (v.vendedores || []).filter(vd => !fVend || vd.nome === fVend);
    } else if (dimensao === 'grupo') {
      fonte = v.grupos || [];
    } else if (dimensao === 'subgrupo') {
      fonte = (v.subgrupos || []).filter(s => !fSubgrupo || s.nome === fSubgrupo);
    } else if (dimensao === 'produto') {
      fonte = (v.produtos || []).filter(p => !fProduto || p.nome === fProduto);
    } else if (dimensao === 'hora') {
      fonte = (v.horas || []).map(h => ({ ...h, nome: h.faixa }));
    } else if (dimensao === 'dia') {
      fonte = [{ nome: dataDia, qtd: v.totais?.qtd || 0, total: v.totais?.total || 0 }];
    } else {
      fonte = [{ nome: dataDia, qtd: v.totais?.qtd || 0, total: v.totais?.total || 0 }];
    }

    // Se a dimensão não é "vendedor" mas tem filtro de vendedor, precisa aplicar a proporção
    // (como o TXT não relaciona vendedor × produto diretamente, só dá pra fazer assim)
    if (fVend && dimensao !== 'vendedor') {
      const vendedorDia = (v.vendedores || []).find(vd => vd.nome === fVend);
      if (!vendedorDia) return;
      const proporcao = vendedorDia.total / (v.totais?.total || 1);
      fonte = fonte.map(x => ({
        ...x,
        qtd: (x.qtd || 0) * proporcao,
        total: (x.total || 0) * proporcao
      }));
    }

    fonte.forEach(item => {
      let chave;
      if (dimensao === 'dia') chave = fmtData(dataDia);
      else chave = item.nome;

      if (!buckets[chave]) buckets[chave] = { qtd: 0, total: 0, dias: new Set() };
      buckets[chave].qtd   += item.qtd || 0;
      buckets[chave].total += item.total || 0;
      buckets[chave].dias.add(dataDia);
    });
  });

  const ordenado = Object.entries(buckets)
    .map(([k, v]) => ({ chave: k, qtd: v.qtd, total: v.total, dias: v.dias.size }))
    .sort((a, b) => {
      if (dimensao === 'hora' || dimensao === 'dia') {
        return a.chave.localeCompare(b.chave);
      }
      return b.total - a.total;
    });

  if (!ordenado.length) {
    resultado.innerHTML = '<p class="text-muted text-center" style="padding:20px">Sem dados para os filtros selecionados.</p>';
    return;
  }

  const maior = Math.max(...ordenado.map(r => r.total));
  const totalGeral = ordenado.reduce((s, r) => s + r.total, 0);
  const qtdTotal = ordenado.reduce((s, r) => s + r.qtd, 0);
  const avisoProporcao = (fVend && dimensao !== 'vendedor')
    ? `<div class="expl-aviso">⚠️ Valores estimados por proporção do vendedor sobre o total do dia</div>`
    : '';

  resultado.innerHTML = `
    <div class="expl-resumo">
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Registros</div>
        <div class="expl-resumo-val">${ordenado.length}</div>
      </div>
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Faturamento</div>
        <div class="expl-resumo-val vinho">${fmtMoeda(totalGeral)}</div>
      </div>
      <div class="expl-resumo-item">
        <div class="expl-resumo-label">Unidades</div>
        <div class="expl-resumo-val">${fmtInt(qtdTotal)}</div>
      </div>
    </div>
    ${avisoProporcao}
    <table class="expl-tabela">
      <thead>
        <tr>
          <th class="expl-th-pos">#</th>
          <th class="expl-th-chave">${dimensaoLabel(dimensao)}</th>
          <th class="expl-th-num">Unidades</th>
          <th class="expl-th-num">Faturamento</th>
          <th class="expl-th-barra">Participação</th>
        </tr>
      </thead>
      <tbody>
        ${ordenado.slice(0, 30).map((r, i) => {
          const pct = maior ? (r.total / maior) * 100 : 0;
          const pctTotal = totalGeral ? (r.total / totalGeral) * 100 : 0;
          return `
            <tr>
              <td class="expl-td-pos">${i + 1}</td>
              <td class="expl-td-chave" title="${r.chave}">${r.chave}</td>
              <td class="expl-td-num">${fmtInt(r.qtd)}</td>
              <td class="expl-td-num expl-td-vinho">${fmtMoeda(r.total)}</td>
              <td class="expl-td-barra">
                <div class="expl-barra-wrap">
                  <div class="expl-barra-fill" style="width:${pct}%"></div>
                </div>
                <span class="expl-barra-pct">${pctTotal.toFixed(1)}%</span>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    ${ordenado.length > 30 ? `<p class="text-muted text-center" style="padding:10px;font-size:11px">Mostrando top 30 de ${ordenado.length} registros. Use filtros pra refinar.</p>` : ''}
  `;
}

function dimensaoLabel(d) {
  return {
    vendedor: 'Vendedor',
    grupo: 'Grupo',
    subgrupo: 'Subgrupo',
    produto: 'Produto',
    hora: 'Faixa de hora',
    dia: 'Dia'
  }[d] || d;
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
