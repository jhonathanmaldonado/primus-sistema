// ===== AUDITORIA — PRIMUS =====
// Cruza 4 fontes pra detectar divergências de estoque:
//   Contagem INI + Recebimentos - Vendas = Esperado
//   Contagem FIN = Real
//   Divergência = Esperado - Real
//
// Entrega 1: seleção de período, cálculo básico, tabela completa.

import { listarContagens, listarVendas, listarRecebimentos } from './db.js';
import { BEBIDAS, slugify, converterParaCaixas } from './produtos.js';

// ===== ESTADO =====
let dataInicio = '';
let dataFim    = '';
let resultadoAuditoria = [];  // array de { slug, nome, grupo, ini, fin, recebido, vendido, esperado, real, diferenca, status }

const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtSgn   = v => { const n = Math.round(v || 0); return n > 0 ? `+${n}` : `${n}`; };
const fmtData  = d => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarAuditoria() {
  const container = document.getElementById('auditoria-container');
  if (!container) return;

  // Datas padrão: últimos 1 dia (auditoria diária do dia de ontem)
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const ontemIso = toIso(ontem);

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>🔍 Auditoria de Estoque</h3>
        <span class="grafico-sub" id="aud-sub">Selecione o período</span>
      </div>

      <div class="aud-periodo">
        <div class="aud-periodo-campo">
          <label>📅 Contagem de INÍCIO</label>
          <input type="date" id="aud-data-inicio" value="${ontemIso}">
        </div>
        <div class="aud-periodo-sep">→</div>
        <div class="aud-periodo-campo">
          <label>🌙 Contagem de FINAL</label>
          <input type="date" id="aud-data-fim" value="${ontemIso}">
        </div>
        <button class="btn btn-primary" id="aud-executar">🔍 Executar auditoria</button>
      </div>

      <div class="aud-info">
        <strong>Como funciona:</strong>
        Busca a contagem INI na data de início e a FIN na data de final. Soma recebimentos e
        subtrai vendas do PDV no período. Compara com a contagem final pra detectar divergências.
      </div>

      <div id="aud-loading" style="display:none;text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Executando auditoria...</div>
      </div>

      <div id="aud-erro" style="display:none"></div>
      <div id="aud-resumo" style="display:none"></div>
      <div id="aud-tabela" style="display:none"></div>
    </div>
  `;

  document.getElementById('aud-executar').onclick = executarAuditoria;
}

// ===== EXECUÇÃO =====
async function executarAuditoria() {
  dataInicio = document.getElementById('aud-data-inicio').value;
  dataFim    = document.getElementById('aud-data-fim').value;

  if (!dataInicio || !dataFim) {
    mostrarErro('Selecione as duas datas.');
    return;
  }
  if (dataInicio > dataFim) {
    mostrarErro('A data de início precisa ser anterior ou igual à data final.');
    return;
  }

  const loading = document.getElementById('aud-loading');
  const erro    = document.getElementById('aud-erro');
  const resumo  = document.getElementById('aud-resumo');
  const tabela  = document.getElementById('aud-tabela');

  loading.style.display = 'block';
  erro.style.display    = 'none';
  resumo.style.display  = 'none';
  tabela.style.display  = 'none';

  try {
    // 1) Busca contagens no período (filtra ini e fin)
    const todasContagens = await listarContagens({ limite: 500 });

    // Pega a MAIS RECENTE contagem ini na data de início (ou mais próxima)
    const contagemIni = todasContagens.find(c =>
      c.tipo === 'ini' && c.data === dataInicio
    );
    // Pega a MAIS RECENTE contagem fin na data de fim
    const contagemFin = todasContagens.find(c =>
      c.tipo === 'fin' && c.data === dataFim
    );

    if (!contagemIni) {
      mostrarErro(`Não encontrei contagem de INÍCIO na data ${fmtData(dataInicio)}. Peça pro barman fazer essa contagem primeiro.`);
      return;
    }
    if (!contagemFin) {
      mostrarErro(`Não encontrei contagem de FINAL na data ${fmtData(dataFim)}. Peça pro barman fazer essa contagem primeiro.`);
      return;
    }

    // 2) Busca vendas no período
    const vendas = await listarVendas({
      dataInicio,
      dataFim,
      limite: 365
    });

    // 3) Busca recebimentos no período
    const recebimentos = await listarRecebimentos(dataInicio, dataFim);

    // 4) Calcula auditoria pra cada bebida
    resultadoAuditoria = calcularAuditoria(contagemIni, contagemFin, vendas, recebimentos);

    // 5) Renderiza
    renderizarResumo(contagemIni, contagemFin, vendas, recebimentos);
    renderizarTabela();

    loading.style.display = 'none';
    resumo.style.display  = 'block';
    tabela.style.display  = 'block';
  } catch (e) {
    console.error(e);
    mostrarErro('Erro: ' + e.message);
    loading.style.display = 'none';
  }
}

function mostrarErro(msg) {
  const erro = document.getElementById('aud-erro');
  erro.innerHTML = `<div class="preview-err">${msg}</div>`;
  erro.style.display = 'block';
  document.getElementById('aud-loading').style.display = 'none';
}

// ===== MOTOR DO CÁLCULO =====
function calcularAuditoria(contagemIni, contagemFin, vendas, recebimentos) {
  // Extrai estoques por slug das contagens
  const estoqueIni = extrairEstoque(contagemIni);
  const estoqueFin = extrairEstoque(contagemFin);

  // Soma recebimentos por slug
  const recebidoPorSlug = {};
  recebimentos.forEach(r => {
    (r.itens || []).forEach(i => {
      if (!recebidoPorSlug[i.slug]) recebidoPorSlug[i.slug] = 0;
      recebidoPorSlug[i.slug] += i.qtd || 0;
    });
  });

  // Soma vendas por slug (match fuzzy pelo nome → slug)
  const vendidoPorSlug = {};
  vendas.forEach(v => {
    (v.produtos || []).forEach(p => {
      const slugP = slugify(p.nome);
      if (!vendidoPorSlug[slugP]) vendidoPorSlug[slugP] = 0;
      vendidoPorSlug[slugP] += p.qtd || 0;
    });
  });

  // Monta linha por bebida
  return BEBIDAS.map(bebida => {
    const slug = slugify(bebida.nome);
    const ini  = estoqueIni[slug] || 0;
    const fin  = estoqueFin[slug] || 0;
    const recebido = recebidoPorSlug[slug] || 0;
    const vendido  = vendidoPorSlug[slug] || 0;

    const esperado = ini + recebido - vendido;
    const real     = fin;
    const diferenca = real - esperado;  // negativo = sumiu; positivo = sobrou

    // Status por diferença absoluta
    const abs = Math.abs(diferenca);
    let status = 'ok';
    if (ini === 0 && fin === 0 && recebido === 0 && vendido === 0) status = 'semdados';
    else if (abs >= 5) status = 'critico';
    else if (abs >= 2) status = 'atencao';
    else if (abs >= 1) status = 'leve';

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      ini,
      recebido,
      vendido,
      esperado,
      real,
      diferenca,
      status
    };
  });
}

// Extrai estoque por slug, lidando com as 2 estruturas (ini e fin)
function extrairEstoque(contagem) {
  const estoque = {};
  Object.entries(contagem.itens || {}).forEach(([chave, v]) => {
    if (typeof v !== 'object' || v === null) return;
    if (chave.endsWith('__fin')) {
      const slug = chave.replace(/__fin$/, '');
      estoque[slug] = v.final || 0;
      return;
    }
    const total = (typeof v.total === 'number' && v.total > 0)
      ? v.total
      : (v.fr || v.freezer || 0) + (v.est || v.estoque || 0);
    estoque[chave] = total;
  });
  return estoque;
}

// ===== RENDERIZAR RESUMO =====
function renderizarResumo(contagemIni, contagemFin, vendas, recebimentos) {
  const resumo = document.getElementById('aud-resumo');
  const sub = document.getElementById('aud-sub');

  const periodoLabel = dataInicio === dataFim
    ? fmtData(dataInicio)
    : `${fmtData(dataInicio)} → ${fmtData(dataFim)}`;
  sub.textContent = `${periodoLabel} · ${vendas.length} ${vendas.length === 1 ? 'dia de venda' : 'dias de venda'}`;

  // Conta status
  const criticos = resultadoAuditoria.filter(r => r.status === 'critico').length;
  const atencao  = resultadoAuditoria.filter(r => r.status === 'atencao').length;
  const leves    = resultadoAuditoria.filter(r => r.status === 'leve').length;
  const ok       = resultadoAuditoria.filter(r => r.status === 'ok').length;
  const semdados = resultadoAuditoria.filter(r => r.status === 'semdados').length;

  // Totais gerais (unidades)
  const totalIni = resultadoAuditoria.reduce((s, r) => s + r.ini, 0);
  const totalRec = resultadoAuditoria.reduce((s, r) => s + r.recebido, 0);
  const totalVen = resultadoAuditoria.reduce((s, r) => s + r.vendido, 0);
  const totalFin = resultadoAuditoria.reduce((s, r) => s + r.real, 0);
  const totalDif = resultadoAuditoria.reduce((s, r) => s + r.diferenca, 0);

  resumo.innerHTML = `
    <div class="aud-kpis">
      <div class="aud-kpi aud-kpi-critico">
        <div class="aud-kpi-val">${criticos}</div>
        <div class="aud-kpi-label">CRÍTICOS (≥5 un)</div>
      </div>
      <div class="aud-kpi aud-kpi-atencao">
        <div class="aud-kpi-val">${atencao}</div>
        <div class="aud-kpi-label">ATENÇÃO (2-4)</div>
      </div>
      <div class="aud-kpi aud-kpi-leve">
        <div class="aud-kpi-val">${leves}</div>
        <div class="aud-kpi-label">LEVES (1)</div>
      </div>
      <div class="aud-kpi aud-kpi-ok">
        <div class="aud-kpi-val">${ok}</div>
        <div class="aud-kpi-label">OK (0)</div>
      </div>
      <div class="aud-kpi aud-kpi-semdados">
        <div class="aud-kpi-val">${semdados}</div>
        <div class="aud-kpi-label">SEM DADOS</div>
      </div>
    </div>

    <div class="aud-equacao">
      <div class="aud-eq-item">
        <div class="aud-eq-label">INICIAL</div>
        <div class="aud-eq-val">${fmtInt(totalIni)}</div>
      </div>
      <div class="aud-eq-op">+</div>
      <div class="aud-eq-item aud-eq-recebido">
        <div class="aud-eq-label">RECEBIDO</div>
        <div class="aud-eq-val">${fmtInt(totalRec)}</div>
        <div class="aud-eq-sub">${recebimentos.length} ${recebimentos.length === 1 ? 'entrega' : 'entregas'}</div>
      </div>
      <div class="aud-eq-op">−</div>
      <div class="aud-eq-item aud-eq-vendido">
        <div class="aud-eq-label">VENDIDO</div>
        <div class="aud-eq-val">${fmtInt(totalVen)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item aud-eq-esperado">
        <div class="aud-eq-label">ESPERADO</div>
        <div class="aud-eq-val">${fmtInt(totalIni + totalRec - totalVen)}</div>
      </div>
      <div class="aud-eq-op aud-eq-vs">vs</div>
      <div class="aud-eq-item aud-eq-real">
        <div class="aud-eq-label">REAL (FIN)</div>
        <div class="aud-eq-val">${fmtInt(totalFin)}</div>
      </div>
      <div class="aud-eq-op">=</div>
      <div class="aud-eq-item ${totalDif < 0 ? 'aud-eq-neg' : totalDif > 0 ? 'aud-eq-pos' : 'aud-eq-zero'}">
        <div class="aud-eq-label">DIFERENÇA</div>
        <div class="aud-eq-val">${fmtSgn(totalDif)}</div>
      </div>
    </div>
  `;
}

// ===== RENDERIZAR TABELA =====
function renderizarTabela() {
  const tabela = document.getElementById('aud-tabela');

  // Ordena: críticos primeiro, depois atenção, leves, ok, sem dados (mesma lógica da lista de compras)
  const ordemStatus = { critico: 0, atencao: 1, leve: 2, ok: 3, semdados: 4 };
  const sorted = [...resultadoAuditoria].sort((a, b) => {
    const ds = ordemStatus[a.status] - ordemStatus[b.status];
    if (ds !== 0) return ds;
    // Dentro do mesmo status, ordena por |diferença| descendente
    return Math.abs(b.diferenca) - Math.abs(a.diferenca);
  });

  // Agrupa por grupo (Cervejas, Refrigerantes, etc) pra facilitar leitura
  const grupos = {};
  sorted.forEach(r => {
    if (!grupos[r.grupo]) grupos[r.grupo] = [];
    grupos[r.grupo].push(r);
  });

  tabela.innerHTML = `
    <h4 class="aud-sec-title">📋 Detalhamento por produto</h4>
    <div class="aud-lista">
      <div class="aud-linha aud-cab">
        <div>Produto</div>
        <div title="Contagem inicial">INI</div>
        <div title="Recebido no período">+REC</div>
        <div title="Vendido no período (PDV)">−VEN</div>
        <div title="Estoque esperado ao final">=ESP</div>
        <div title="Contagem real ao final">REAL</div>
        <div title="Diferença (Real − Esperado)">DIF</div>
        <div>Status</div>
      </div>
      ${Object.entries(grupos).map(([grupo, itens]) => `
        <div class="aud-grupo-header">${grupo}</div>
        ${itens.map(renderLinhaAud).join('')}
      `).join('')}
    </div>
  `;
}

function renderLinhaAud(r) {
  const statusBadge = {
    critico:  '<span class="aud-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="aud-badge bad-atencao">ATENÇÃO</span>',
    leve:     '<span class="aud-badge bad-leve">LEVE</span>',
    ok:       '<span class="aud-badge bad-ok">OK</span>',
    semdados: '<span class="aud-badge bad-semdados">s/ dados</span>'
  }[r.status];

  // Conversão da diferença pra caixa/fardo (útil pra entender o tamanho do problema)
  const produtoInfo = { unidCompra: r.unidCompra, porCaixa: r.porCaixa };
  const convDif = Math.abs(r.diferenca) >= (r.porCaixa || 999)
    ? ` (${converterParaCaixas(Math.abs(r.diferenca), produtoInfo)})`
    : '';

  const difClasse = r.diferenca < 0 ? 'aud-dif-neg' :
                    r.diferenca > 0 ? 'aud-dif-pos' : 'aud-dif-zero';

  return `
    <div class="aud-linha aud-linha-${r.status}">
      <div class="aud-nome">${r.nome}</div>
      <div class="aud-num">${fmtInt(r.ini)}</div>
      <div class="aud-num aud-num-pos">${r.recebido > 0 ? '+' + fmtInt(r.recebido) : '—'}</div>
      <div class="aud-num aud-num-neg">${r.vendido > 0 ? '−' + fmtInt(r.vendido) : '—'}</div>
      <div class="aud-num aud-num-esp">${fmtInt(r.esperado)}</div>
      <div class="aud-num aud-num-real">${fmtInt(r.real)}</div>
      <div class="aud-num ${difClasse}">${fmtSgn(r.diferenca)}${convDif}</div>
      <div>${statusBadge}</div>
    </div>
  `;
}

// ===== UTILS =====
function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
