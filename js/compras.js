// ===== LISTA DE COMPRAS — PRIMUS =====
// Gera sugestão inteligente de compras cruzando:
// - Estoque atual (última contagem "ini" de bebidas)
// - Consumo médio dos últimos 14 dias (vendas do PDV)
// - Configuração: cobertura de 7 dias

import { listarContagens, listarVendas, listarFornecedores, salvarFornecedores } from './db.js';
import {
  BEBIDAS, slugify, FORNECEDORES_PADRAO,
  converterParaCaixas, arredondarParaCaixaCheia
} from './produtos.js';

// ===== CONFIGURAÇÃO =====
const JANELA_CONSUMO_DIAS = 14;   // média calculada sobre os últimos 14 dias
const COBERTURA_ALVO_DIAS = 7;    // sugestão cobre 7 dias
const ALERTA_CRITICO_DIAS = 2;    // < 2 dias = crítico (vermelho)
const ALERTA_ATENCAO_DIAS = 4;    // < 4 dias = atenção (amarelo)

// ===== ESTADO =====
let fornecedoresCache = [];
let sugestaoCache = [];           // produtos com cálculo pronto
let quantidadesAjustadas = {};    // slug → quantidade editada pelo usuário

const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarCompras() {
  const container = document.getElementById('compras-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>🛒 Lista de Compras Inteligente</h3>
        <span class="grafico-sub" id="compras-sub">calculando...</span>
      </div>

      <div class="compras-config">
        <div class="compras-config-info">
          📊 Consumo médio dos últimos <strong>${JANELA_CONSUMO_DIAS} dias</strong>
          · Sugestão para cobrir <strong>${COBERTURA_ALVO_DIAS} dias</strong>
        </div>
        <div class="compras-acoes-topo">
          <button class="btn btn-ghost btn-sm" id="btn-fornecedores">⚙️ Gerenciar fornecedores</button>
          <button class="btn btn-ghost btn-sm" id="btn-recalcular">🔄 Recalcular</button>
        </div>
      </div>

      <div id="compras-loading" style="text-align:center;padding:40px">
        <span class="spinner"></span>
        <div style="margin-top:10px;color:var(--cinza-texto);font-size:13px">Cruzando estoque e consumo...</div>
      </div>

      <div id="compras-vazio" style="display:none">
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h3>Dados insuficientes pra calcular</h3>
          <p id="compras-vazio-msg"></p>
        </div>
      </div>

      <div id="compras-resumo" style="display:none"></div>
      <div id="compras-lista" style="display:none"></div>
      <div id="compras-acoes-rodape" style="display:none"></div>
    </div>

    <!-- Modal: Gerenciar Fornecedores -->
    <div class="modal-backdrop" id="modal-fornecedores">
      <div class="modal-box" style="max-width:700px">
        <button class="modal-close" id="modal-forn-close">✕</button>
        <div class="modal-head">
          <h3>⚙️ Fornecedores e produtos</h3>
          <p>Agrupe produtos por fornecedor pra listas organizadas</p>
        </div>
        <div style="padding:16px 24px 24px">
          <div class="fornecedores-lista" id="fornecedores-lista"></div>
          <button class="btn btn-primary" id="btn-novo-fornecedor" style="margin-top:14px;width:100%">
            + Adicionar fornecedor
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-fornecedores').onclick = abrirModalFornecedores;
  document.getElementById('btn-recalcular').onclick = carregarECalcular;
  document.getElementById('modal-forn-close').onclick = fecharModalFornecedores;

  await carregarECalcular();
}

// ===== CARREGAR DADOS E CALCULAR SUGESTÃO =====
async function carregarECalcular() {
  const loading = document.getElementById('compras-loading');
  const vazio   = document.getElementById('compras-vazio');
  const resumo  = document.getElementById('compras-resumo');
  const lista   = document.getElementById('compras-lista');
  const rodape  = document.getElementById('compras-acoes-rodape');

  loading.style.display = 'block';
  vazio.style.display   = 'none';
  resumo.style.display  = 'none';
  lista.style.display   = 'none';
  rodape.style.display  = 'none';

  try {
    // 1) Busca última contagem INI (estoque atual)
    const contagens = await listarContagens({ tipo: 'ini', limite: 50 });
    if (!contagens.length) {
      mostrarVazio('Nenhuma contagem de Bebidas Início foi encontrada. Peça pro barman fazer uma contagem primeiro.');
      return;
    }
    const ultimaContagem = contagens[0];  // já vem ordenada desc

    // 2) Busca vendas dos últimos 14 dias
    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - (JANELA_CONSUMO_DIAS - 1));
    const dataInicio = toIso(inicio);
    const vendas = await listarVendas({ dataInicio, limite: 365 });

    if (!vendas.length) {
      mostrarVazio('Nenhuma venda importada no período. Suba o TXT do PDV na aba Vendas primeiro.');
      return;
    }

    // 3) Busca fornecedores — se for a primeira vez, faz seed automático
    fornecedoresCache = await listarFornecedores();
    if (!fornecedoresCache.length) {
      fornecedoresCache = await criarFornecedoresPadrao();
    }

    // 4) Calcula sugestão
    sugestaoCache = calcularSugestao(ultimaContagem, vendas);

    // 5) Renderiza
    quantidadesAjustadas = {};  // reset ao recalcular
    renderizar(ultimaContagem, vendas.length);

    loading.style.display = 'none';
  } catch (e) {
    console.error(e);
    loading.innerHTML = `<div class="preview-err">Erro: ${e.message}</div>`;
  }
}

function mostrarVazio(msg) {
  document.getElementById('compras-loading').style.display = 'none';
  document.getElementById('compras-vazio').style.display = 'block';
  document.getElementById('compras-vazio-msg').textContent = msg;
}

/**
 * Cria os fornecedores padrão (LOUVADA, AMBEV, SOLAR+, PRATA, JONG)
 * e associa automaticamente cada produto ao fornecedor definido no catálogo.
 * Executado apenas na primeira vez.
 */
async function criarFornecedoresPadrao() {
  // Começa com os fornecedores padrão, sem produtos associados ainda
  const lista = FORNECEDORES_PADRAO.map(f => ({
    id: f.id,
    nome: f.nome,
    telefone: f.telefone || '',
    produtos: []
  }));

  // Associa cada produto ao seu fornecedor (a partir do campo "fornecedor" no catálogo)
  BEBIDAS.forEach(b => {
    if (!b.fornecedor) return;
    const forn = lista.find(f => f.nome === b.fornecedor);
    if (forn) {
      forn.produtos.push(slugify(b.nome));
    }
  });

  await salvarFornecedores(lista);
  return lista;
}

// ===== MOTOR DO CÁLCULO =====
// Para cada bebida:
//   estoque = qtd na última contagem "ini"
//   consumo = soma das qtd vendidas no período / dias com venda (média diária real)
//   cobertura = estoque / consumo (em dias)
//   sugerido = max(0, consumo * 7 - estoque)
function calcularSugestao(contagem, vendas) {
  // Extrai estoque por produto a partir da contagem
  // Estrutura de contagem.itens: { slug: { freezer: N, estoque: N, obs?: '...' } }
  const estoquePorSlug = {};
  Object.entries(contagem.itens || {}).forEach(([slug, v]) => {
    if (typeof v === 'object' && v !== null) {
      const total = (v.freezer || 0) + (v.estoque || 0);
      estoquePorSlug[slug] = total;
    }
  });

  // Calcula consumo médio por produto, com matching fuzzy:
  // A contagem usa slugs tipo "heineken_600ml", mas as vendas usam nome "HEINEKEN 600ML"
  const consumoPorSlug = {};
  const diasComVenda = new Set();

  vendas.forEach(v => {
    diasComVenda.add(v.id);
    (v.produtos || []).forEach(p => {
      const slugProduto = slugify(p.nome);
      // Tenta match direto
      if (!consumoPorSlug[slugProduto]) consumoPorSlug[slugProduto] = 0;
      consumoPorSlug[slugProduto] += p.qtd || 0;
    });
  });

  const qtdDias = Math.max(diasComVenda.size, 1);

  // Monta sugestão para cada bebida do catálogo
  const sugestao = BEBIDAS.map(bebida => {
    const slug = slugify(bebida.nome);
    const estoque = estoquePorSlug[slug] || 0;

    // Matching de consumo: tenta slug direto primeiro, depois variações
    let totalVendido = consumoPorSlug[slug] || 0;
    // Se não achou, tenta versões alternativas (ex: "Água" vs "Agua")
    if (totalVendido === 0) {
      const slugsSimilares = Object.keys(consumoPorSlug).filter(s =>
        slugsSemelhantes(s, slug)
      );
      if (slugsSimilares.length > 0) {
        totalVendido = slugsSimilares.reduce((sum, s) => sum + consumoPorSlug[s], 0);
      }
    }

    const consumoDia = totalVendido / qtdDias;
    const cobertura = consumoDia > 0 ? estoque / consumoDia : 999;
    const necessidadeAlvo = consumoDia * COBERTURA_ALVO_DIAS;
    const sugeridoBruto = Math.max(0, Math.ceil(necessidadeAlvo - estoque));
    // Arredonda pra caixa/fardo cheio quando aplicável
    const sugerido = arredondarParaCaixaCheia(sugeridoBruto, bebida);

    // Status
    let status = 'ok';
    if (consumoDia === 0 && estoque === 0) status = 'semdados';
    else if (cobertura < ALERTA_CRITICO_DIAS) status = 'critico';
    else if (cobertura < ALERTA_ATENCAO_DIAS) status = 'atencao';
    else if (cobertura < COBERTURA_ALVO_DIAS) status = 'medio';

    return {
      slug,
      nome: bebida.nome,
      grupo: bebida.grupo,
      unidCompra: bebida.unidCompra,
      porCaixa: bebida.porCaixa,
      estoque,
      consumoDia,
      cobertura,
      sugerido,
      status
    };
  });

  return sugestao;
}

// Compara dois slugs pra decidir se são o "mesmo" produto (matching fuzzy)
function slugsSemelhantes(a, b) {
  if (a === b) return true;
  // Remove plurais simples, underscores e números pra comparar
  const norm = s => s.replace(/[_\d]+/g, '').replace(/s$/, '');
  return norm(a) === norm(b);
}

// ===== RENDERIZAR =====
function renderizar(contagemUsada, totalDiasVendas) {
  const sub    = document.getElementById('compras-sub');
  const resumo = document.getElementById('compras-resumo');
  const lista  = document.getElementById('compras-lista');
  const rodape = document.getElementById('compras-acoes-rodape');

  sub.innerHTML = `Última contagem: <strong>${fmtData(contagemUsada.data)}</strong> · Vendas de <strong>${totalDiasVendas} ${totalDiasVendas === 1 ? 'dia' : 'dias'}</strong>`;

  // Resumo superior: KPIs rápidos
  const criticos = sugestaoCache.filter(s => s.status === 'critico').length;
  const atencao  = sugestaoCache.filter(s => s.status === 'atencao').length;
  const aComprar = sugestaoCache.filter(s => s.sugerido > 0).length;
  const totalItens = sugestaoCache.reduce((sum, s) => sum + s.sugerido, 0);

  resumo.innerHTML = `
    <div class="compras-kpis">
      <div class="compras-kpi kpi-critico">
        <div class="compras-kpi-val">${criticos}</div>
        <div class="compras-kpi-label">CRÍTICOS (&lt;${ALERTA_CRITICO_DIAS} dias)</div>
      </div>
      <div class="compras-kpi kpi-atencao">
        <div class="compras-kpi-val">${atencao}</div>
        <div class="compras-kpi-label">ATENÇÃO (&lt;${ALERTA_ATENCAO_DIAS} dias)</div>
      </div>
      <div class="compras-kpi">
        <div class="compras-kpi-val">${aComprar}</div>
        <div class="compras-kpi-label">A COMPRAR</div>
      </div>
      <div class="compras-kpi kpi-destaque">
        <div class="compras-kpi-val">${fmtInt(totalItens)}</div>
        <div class="compras-kpi-label">UNIDADES SUGERIDAS</div>
      </div>
    </div>
  `;
  resumo.style.display = 'block';

  // Agrupa por fornecedor
  const agrupado = agruparPorFornecedor(sugestaoCache, fornecedoresCache);
  lista.innerHTML = agrupado.map(g => renderGrupoFornecedor(g)).join('');
  lista.style.display = 'block';

  // Ações no rodapé
  rodape.innerHTML = `
    <div class="compras-rodape">
      <button class="btn btn-ghost" id="btn-exportar-pdf">📄 Exportar PDF por fornecedor</button>
      <button class="btn btn-primary" id="btn-salvar-lista">💾 Salvar lista</button>
    </div>
  `;
  rodape.style.display = 'block';

  document.getElementById('btn-exportar-pdf').onclick = exportarPDF;
  document.getElementById('btn-salvar-lista').onclick = salvarLista;

  // Listeners nos inputs de qtd editável
  document.querySelectorAll('.compra-qtd-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const slug = e.target.dataset.slug;
      const v = parseInt(e.target.value, 10) || 0;
      quantidadesAjustadas[slug] = v;

      // Atualiza o texto "= N caixas" ao lado do input
      const item = sugestaoCache.find(x => x.slug === slug);
      const convEl = document.querySelector(`[data-slug-conv="${slug}"]`);
      if (item && convEl) {
        const produtoInfo = { unidCompra: item.unidCompra, porCaixa: item.porCaixa };
        convEl.textContent = v > 0 ? converterParaCaixas(v, produtoInfo) : '';
      }

      atualizarTotaisRodape();
    });
  });
}

function agruparPorFornecedor(itens, fornecedores) {
  // Mapa slug → fornecedor
  const mapaForn = {};
  fornecedores.forEach(f => {
    (f.produtos || []).forEach(slug => { mapaForn[slug] = f; });
  });

  // Agrupa
  const grupos = {};
  itens.forEach(item => {
    const f = mapaForn[item.slug];
    const chave = f ? f.nome : '__sem_fornecedor__';
    if (!grupos[chave]) {
      grupos[chave] = {
        fornecedor: f || null,
        nome: f ? f.nome : 'Sem fornecedor cadastrado',
        itens: []
      };
    }
    grupos[chave].itens.push(item);
  });

  // Ordena: fornecedores cadastrados primeiro (ordem do cadastro), "sem fornecedor" por último
  const arr = Object.values(grupos);
  arr.sort((a, b) => {
    if (a.fornecedor && !b.fornecedor) return -1;
    if (!a.fornecedor && b.fornecedor) return 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  // Dentro de cada grupo: críticos primeiro, depois por cobertura crescente
  arr.forEach(g => {
    const ordemStatus = { critico: 0, atencao: 1, medio: 2, ok: 3, semdados: 4 };
    g.itens.sort((a, b) => {
      const ds = (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9);
      if (ds !== 0) return ds;
      return a.cobertura - b.cobertura;
    });
  });

  return arr;
}

function renderGrupoFornecedor(g) {
  const qtdAComprar = g.itens.filter(i => (quantidadesAjustadas[i.slug] ?? i.sugerido) > 0).length;
  const telefone = g.fornecedor?.telefone
    ? `<span class="forn-tel">📱 ${g.fornecedor.telefone}</span>`
    : '';

  return `
    <div class="compras-grupo">
      <div class="compras-grupo-head">
        <h4>🏬 ${g.nome} ${telefone}</h4>
        <span class="compras-grupo-meta">${qtdAComprar} item(ns) a comprar</span>
      </div>
      <div class="compras-tabela">
        <div class="compras-linha compras-cab">
          <div>Produto</div>
          <div>Estoque</div>
          <div>Consumo/dia</div>
          <div>Cobertura</div>
          <div>Sugerido</div>
          <div>Comprar</div>
        </div>
        ${g.itens.map(i => renderLinhaProduto(i)).join('')}
      </div>
    </div>
  `;
}

function renderLinhaProduto(i) {
  const qtdAtual = quantidadesAjustadas[i.slug] ?? i.sugerido;
  const coberturaTxt = i.cobertura >= 999 ? '—' :
                       i.cobertura >= 30  ? '30+ dias' :
                       `${i.cobertura.toFixed(1)} dias`;
  const statusBadge = {
    critico:  '<span class="compra-badge bad-critico">CRÍTICO</span>',
    atencao:  '<span class="compra-badge bad-atencao">ATENÇÃO</span>',
    medio:    '<span class="compra-badge bad-medio">MÉDIO</span>',
    ok:       '<span class="compra-badge bad-ok">OK</span>',
    semdados: '<span class="compra-badge bad-semdados">s/ dados</span>'
  }[i.status];

  // Conversão pra caixa/fardo (mostra ao lado do sugerido e da qtd final)
  const produtoInfo = { unidCompra: i.unidCompra, porCaixa: i.porCaixa };
  const convSugerido = i.sugerido > 0 ? converterParaCaixas(i.sugerido, produtoInfo) : '';
  const convAtual    = qtdAtual > 0   ? converterParaCaixas(qtdAtual,   produtoInfo) : '';

  return `
    <div class="compras-linha ${i.status}">
      <div class="compra-nome">
        <div>${i.nome}</div>
        <div class="compra-grupo-label">${i.grupo}</div>
      </div>
      <div class="compra-num">${fmtInt(i.estoque)}</div>
      <div class="compra-num">${i.consumoDia.toFixed(1)}</div>
      <div class="compra-cobertura">${coberturaTxt} ${statusBadge}</div>
      <div class="compra-sugerido">
        <div class="compra-num">${i.sugerido > 0 ? fmtInt(i.sugerido) : '—'}</div>
        ${convSugerido ? `<div class="compra-conv">${convSugerido}</div>` : ''}
      </div>
      <div class="compra-final">
        <input type="number" class="compra-qtd-input" min="0" step="1"
          data-slug="${i.slug}" value="${qtdAtual}">
        <div class="compra-conv compra-conv-final" data-slug-conv="${i.slug}">${convAtual}</div>
      </div>
    </div>
  `;
}

function atualizarTotaisRodape() {
  // Atualiza o "qtd a comprar" por grupo sem re-renderizar tudo
  const grupos = document.querySelectorAll('.compras-grupo');
  grupos.forEach(g => {
    const inputs = g.querySelectorAll('.compra-qtd-input');
    const qtdItens = Array.from(inputs).filter(inp => parseInt(inp.value, 10) > 0).length;
    const meta = g.querySelector('.compras-grupo-meta');
    if (meta) meta.textContent = `${qtdItens} item(ns) a comprar`;
  });
}

// ===== AÇÕES =====

async function salvarLista() {
  mostrarToast('Lista salva! (em produção, salva no Firestore)', 'ok');
  // TODO: salvar lista com snapshot em primus_compras/YYYY-MM-DD
}

function exportarPDF() {
  // Usa jsPDF se disponível (carregado via CDN na página)
  if (typeof window.jspdf === 'undefined') {
    mostrarToast('jsPDF não carregado. Impressão com a janela do navegador.', 'err');
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const agrupado = agruparPorFornecedor(sugestaoCache, fornecedoresCache);
  const dataHoje = fmtData(toIso(new Date()));

  // Filtra só os que têm qtd a comprar
  const gruposFiltrados = agrupado.map(g => ({
    ...g,
    itens: g.itens.filter(i => (quantidadesAjustadas[i.slug] ?? i.sugerido) > 0)
  })).filter(g => g.itens.length > 0);

  if (!gruposFiltrados.length) {
    mostrarToast('Nenhum item a comprar no momento.', 'err');
    return;
  }

  gruposFiltrados.forEach((g, idx) => {
    if (idx > 0) doc.addPage();

    // Cabeçalho
    doc.setFillColor(124, 0, 71);  // vinho
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('PRIMUS PEIXARIA', 15, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Lista de Compras · ' + dataHoje, 15, 22);

    // Fornecedor
    doc.setTextColor(0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(g.nome, 15, 42);
    if (g.fornecedor?.telefone) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Tel: ' + g.fornecedor.telefone, 15, 48);
    }

    // Tabela
    let y = 58;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, 180, 7, 'F');
    doc.text('Produto', 17, y);
    doc.text('Qtd', 130, y, { align: 'right' });
    doc.text('Un', 140, y, { align: 'right' });
    doc.text('Conversão', 190, y, { align: 'right' });
    y += 4;
    doc.setLineWidth(0.3);
    doc.line(15, y, 195, y);
    y += 4;

    doc.setFont('helvetica', 'normal');
    let totalUnidades = 0;
    let totalCaixas = 0;
    let totalFardos = 0;

    g.itens.forEach(i => {
      const qtd = quantidadesAjustadas[i.slug] ?? i.sugerido;
      totalUnidades += qtd;
      const produtoInfo = { unidCompra: i.unidCompra, porCaixa: i.porCaixa };
      const conv = converterParaCaixas(qtd, produtoInfo) || '—';

      // Soma caixas/fardos (pra total do rodapé)
      if (i.unidCompra && i.porCaixa > 1) {
        const nCaixas = Math.floor(qtd / i.porCaixa);
        if (i.unidCompra === 'caixa') totalCaixas += nCaixas;
        else if (i.unidCompra === 'fardo') totalFardos += nCaixas;
      }

      if (y > 270) {
        doc.addPage();
        y = 20;
      }

      doc.text(i.nome, 17, y);
      doc.text(fmtInt(qtd), 130, y, { align: 'right' });
      doc.text('un', 140, y, { align: 'right' });
      doc.setTextColor(90);
      doc.text(conv, 190, y, { align: 'right' });
      doc.setTextColor(0);
      y += 6;
    });

    // Total
    y += 4;
    doc.line(15, y, 195, y);
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${fmtInt(totalUnidades)} unidades`, 15, y);
    const resumoCaixas = [];
    if (totalCaixas > 0) resumoCaixas.push(`${totalCaixas} ${totalCaixas === 1 ? 'caixa' : 'caixas'}`);
    if (totalFardos > 0) resumoCaixas.push(`${totalFardos} ${totalFardos === 1 ? 'fardo' : 'fardos'}`);
    if (resumoCaixas.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('(' + resumoCaixas.join(' + ') + ')', 195, y, { align: 'right' });
    }

    // Rodapé
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120);
    doc.text('Gerado pelo Sistema Primus em ' + dataHoje, 15, 285);
  });

  doc.save(`lista_compras_${dataHoje.replace(/\//g, '-')}.pdf`);
  mostrarToast('PDF gerado!', 'ok');
}

// ===== MODAL DE FORNECEDORES =====

function abrirModalFornecedores() {
  renderizarFornecedoresModal();
  document.getElementById('modal-fornecedores').classList.add('open');

  document.getElementById('btn-novo-fornecedor').onclick = novoFornecedor;
  document.getElementById('modal-fornecedores').onclick = e => {
    if (e.target.id === 'modal-fornecedores') fecharModalFornecedores();
  };
}

function fecharModalFornecedores() {
  document.getElementById('modal-fornecedores').classList.remove('open');
  // Recarrega sugestão pra refletir novos agrupamentos
  carregarECalcular();
}

function renderizarFornecedoresModal() {
  const div = document.getElementById('fornecedores-lista');
  if (!fornecedoresCache.length) {
    div.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">Nenhum fornecedor cadastrado ainda.</p>';
    return;
  }

  div.innerHTML = fornecedoresCache.map((f, idx) => `
    <div class="fornecedor-card" data-idx="${idx}">
      <div class="fornecedor-head">
        <input type="text" class="fornecedor-nome-input" value="${escapeHtml(f.nome)}"
               data-campo="nome" data-idx="${idx}" placeholder="Nome do fornecedor">
        <input type="text" class="fornecedor-tel-input" value="${escapeHtml(f.telefone || '')}"
               data-campo="telefone" data-idx="${idx}" placeholder="Telefone (opcional)">
        <button class="btn btn-danger btn-sm" onclick="removerFornecedor(${idx})" title="Remover fornecedor">🗑️</button>
      </div>
      <div class="fornecedor-produtos">
        <label class="fornecedor-produtos-label">Produtos fornecidos:</label>
        <div class="fornecedor-chips">
          ${BEBIDAS.map(b => {
            const slug = slugify(b.nome);
            const marcado = (f.produtos || []).includes(slug);
            return `
              <label class="chip-produto ${marcado ? 'ativo' : ''}">
                <input type="checkbox" data-idx="${idx}" data-slug="${slug}"
                       ${marcado ? 'checked' : ''}>
                <span>${b.nome}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `).join('');

  // Listeners para salvar ao digitar/marcar
  div.querySelectorAll('.fornecedor-nome-input, .fornecedor-tel-input').forEach(inp => {
    inp.onblur = async () => {
      const idx = +inp.dataset.idx;
      const campo = inp.dataset.campo;
      fornecedoresCache[idx][campo] = inp.value.trim();
      await salvarFornecedores(fornecedoresCache);
    };
  });

  div.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.onchange = async () => {
      const idx = +cb.dataset.idx;
      const slug = cb.dataset.slug;
      if (!fornecedoresCache[idx].produtos) fornecedoresCache[idx].produtos = [];
      const lista = fornecedoresCache[idx].produtos;
      if (cb.checked) {
        if (!lista.includes(slug)) lista.push(slug);
      } else {
        const i = lista.indexOf(slug);
        if (i >= 0) lista.splice(i, 1);
      }
      // Feedback visual no chip
      cb.closest('.chip-produto').classList.toggle('ativo', cb.checked);
      await salvarFornecedores(fornecedoresCache);
    };
  });
}

async function novoFornecedor() {
  const nome = prompt('Nome do novo fornecedor:');
  if (!nome || !nome.trim()) return;
  fornecedoresCache.push({
    id: Date.now().toString(),
    nome: nome.trim(),
    telefone: '',
    produtos: []
  });
  await salvarFornecedores(fornecedoresCache);
  renderizarFornecedoresModal();
}

window.removerFornecedor = async function(idx) {
  const f = fornecedoresCache[idx];
  if (!f) return;
  if (!confirm(`Remover fornecedor "${f.nome}"?\n\nOs produtos dele voltam para "Sem fornecedor cadastrado".`)) return;
  fornecedoresCache.splice(idx, 1);
  await salvarFornecedores(fornecedoresCache);
  renderizarFornecedoresModal();
};

// ===== UTILS =====
function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
