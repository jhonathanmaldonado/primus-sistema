// ===== VENDAS — PRIMUS =====
// Upload de TXT do PDV, listagem de dias importados, visualização de detalhes

import { parsePdvTxt, resumirParse } from './pdv-parser.js';
import { salvarVendas, listarDatasVendas, buscarVendasDia, listarVendas } from './db.js';
import { recarregarDashboard } from './dashboard.js';

// Cache
let datasImportadas = [];
let arquivoPendente = null; // { nome, parsed, resumo }

// ===== FORMATADORES =====
const fmtMoeda = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtData  = d => { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// ===== INICIALIZAÇÃO =====
export async function inicializarVendas() {
  const container = document.getElementById('vendas-container');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <div class="grafico-head">
        <h3>📤 Importar TXT do PDV</h3>
        <span class="grafico-sub">Suba o arquivo ou cole o conteúdo</span>
      </div>

      <div class="upload-tabs">
        <button class="upload-tab active" data-tab="arquivo">📁 Arquivo</button>
        <button class="upload-tab" data-tab="texto">📋 Colar texto</button>
      </div>

      <div class="upload-tab-content active" data-tab="arquivo">
        <div class="upload-zone" id="upload-zone">
          <input type="file" id="upload-file" accept=".txt">
          <div class="upload-icon">📄</div>
          <div class="upload-title">Clique ou arraste o TXT do PDV aqui</div>
          <div class="upload-hint">Formato esperado: relatório de vendas com seções TURNO, VENDEDOR, PRODUTO, DIA…</div>
        </div>
      </div>

      <div class="upload-tab-content" data-tab="texto">
        <textarea
          id="upload-texto"
          class="upload-textarea"
          placeholder="Cole aqui o conteúdo completo do relatório do PDV (Ctrl+V)..."
          rows="8"
        ></textarea>
        <div class="upload-acoes-texto">
          <span class="upload-hint" id="upload-texto-hint">0 linhas</span>
          <button class="btn btn-primary" id="btn-processar-texto">📊 Processar texto</button>
        </div>
      </div>

      <div id="preview-area" style="display:none"></div>
    </div>

    <div class="card">
      <div class="grafico-head">
        <h3>📁 Dias já importados</h3>
        <span class="grafico-sub" id="sub-importados"></span>
      </div>
      <div id="lista-importados">
        <div style="text-align:center;padding:30px"><span class="spinner"></span></div>
      </div>
    </div>
  `;

  setupTabs();
  setupUpload();
  setupColarTexto();
  await carregarListaImportados();
}

// ===== TABS =====
function setupTabs() {
  document.querySelectorAll('.upload-tab').forEach(tab => {
    tab.onclick = () => {
      const alvo = tab.dataset.tab;
      document.querySelectorAll('.upload-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.upload-tab-content').forEach(c => {
        c.classList.toggle('active', c.dataset.tab === alvo);
      });
      // Limpa prévia ao trocar de aba
      cancelarUpload();
    };
  });
}

// ===== COLAR TEXTO =====
function setupColarTexto() {
  const textarea = document.getElementById('upload-texto');
  const hint = document.getElementById('upload-texto-hint');
  const btn = document.getElementById('btn-processar-texto');

  textarea.addEventListener('input', () => {
    const linhas = textarea.value.split('\n').filter(l => l.trim()).length;
    hint.textContent = `${linhas} ${linhas === 1 ? 'linha' : 'linhas'}`;
    btn.disabled = linhas < 5;
  });

  btn.disabled = true;
  btn.onclick = () => {
    const texto = textarea.value;
    if (!texto.trim()) {
      mostrarToast('Cole o conteúdo do relatório primeiro.', 'err');
      return;
    }
    // Tenta detectar um "nome" virtual pro arquivo a partir do conteúdo
    const hoje = new Date();
    const nomeVirtual = `texto-colado-${hoje.toISOString().slice(0, 10)}.txt`;
    processarTexto(texto, nomeVirtual);
  };
}

// ===== SETUP UPLOAD =====
function setupUpload() {
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('upload-file');

  input.onchange = e => {
    if (e.target.files[0]) processarArquivo(e.target.files[0]);
  };

  ['dragenter', 'dragover'].forEach(ev => {
    zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    });
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) processarArquivo(f);
  });
}

// ===== PROCESSAR ARQUIVO =====
async function processarArquivo(file) {
  if (!file.name.toLowerCase().endsWith('.txt')) {
    mostrarToast('O arquivo precisa ter extensão .txt', 'err');
    return;
  }

  try {
    // Detecta encoding: tenta UTF-8 primeiro, se der caractere quebrado usa ISO-8859-1 (comum em PDVs antigos)
    let texto = await file.text();
    if (/[\uFFFD\u0080-\u009F]/.test(texto)) {
      const buf = await file.arrayBuffer();
      texto = new TextDecoder('iso-8859-1').decode(buf);
    }
    processarTexto(texto, file.name);
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao ler arquivo: ' + e.message, 'err');
  }
}

// ===== PROCESSAR TEXTO (core - funciona pra arquivo ou texto colado) =====
function processarTexto(texto, nomeVirtual = 'texto-colado.txt') {
  const preview = document.getElementById('preview-area');
  preview.style.display = 'block';
  preview.innerHTML = `<div style="text-align:center;padding:30px"><span class="spinner"></span> Processando...</div>`;

  try {
    const parsed = parsePdvTxt(texto);
    const resumo = resumirParse(parsed);

    if (!parsed.data) {
      preview.innerHTML = `
        <div class="preview-err">
          ⚠️ Não foi possível detectar a data do relatório. Verifique se o texto está completo e no formato correto.
        </div>`;
      return;
    }

    arquivoPendente = { nome: nomeVirtual, parsed, resumo };

    const jaExiste = datasImportadas.includes(parsed.data);
    const aviso = jaExiste ? `
      <div class="preview-aviso">
        ⚠️ <strong>Esse dia já foi importado.</strong> Se continuar, os dados anteriores serão sobrescritos.
      </div>` : '';

    preview.innerHTML = `
      <div class="preview-header">
        <span class="preview-icon">✅</span>
        <div>
          <div class="preview-titulo">Texto processado: ${nomeVirtual}</div>
          <div class="preview-sub">Data detectada: <strong>${fmtData(parsed.data)}</strong></div>
        </div>
      </div>

      ${aviso}

      <div class="preview-stats">
        <div class="preview-stat">
          <div class="preview-stat-label">Faturamento</div>
          <div class="preview-stat-value">${fmtMoeda(resumo.totalFaturamento)}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Itens vendidos</div>
          <div class="preview-stat-value">${fmtInt(resumo.totalItens)}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Vendedores</div>
          <div class="preview-stat-value">${resumo.qtdVendedores}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Produtos</div>
          <div class="preview-stat-value">${resumo.qtdProdutos}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Grupos</div>
          <div class="preview-stat-value">${resumo.qtdGrupos}</div>
        </div>
        <div class="preview-stat">
          <div class="preview-stat-label">Faixas de hora</div>
          <div class="preview-stat-value">${resumo.qtdHoras}</div>
        </div>
      </div>

      <div class="preview-acoes">
        <button class="btn btn-ghost" id="btn-cancelar-upload">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirmar-upload">
          ${jaExiste ? '🔄 Sobrescrever' : '💾 Salvar no Firebase'}
        </button>
      </div>
    `;

    document.getElementById('btn-cancelar-upload').onclick = cancelarUpload;
    document.getElementById('btn-confirmar-upload').onclick = confirmarUpload;

  } catch (e) {
    console.error(e);
    preview.innerHTML = `
      <div class="preview-err">
        ⚠️ Erro ao processar: ${e.message}
      </div>`;
  }
}

function cancelarUpload() {
  arquivoPendente = null;
  const preview = document.getElementById('preview-area');
  if (preview) preview.style.display = 'none';
  const fileInput = document.getElementById('upload-file');
  if (fileInput) fileInput.value = '';
  const textarea = document.getElementById('upload-texto');
  if (textarea) {
    textarea.value = '';
    const hint = document.getElementById('upload-texto-hint');
    if (hint) hint.textContent = '0 linhas';
    const btn = document.getElementById('btn-processar-texto');
    if (btn) btn.disabled = true;
  }
}

async function confirmarUpload() {
  if (!arquivoPendente) return;
  const btn = document.getElementById('btn-confirmar-upload');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    const { data, totais, turnos, caixas, vendedores, operadores, grupos, subgrupos, produtos, horas } = arquivoPendente.parsed;
    await salvarVendas(data, {
      totais,
      turnos,
      caixas,
      vendedores,
      operadores: operadores || null,
      grupos,
      subgrupos,
      produtos,
      horas
    });
    mostrarToast(`Vendas de ${fmtData(data)} salvas!`, 'ok');
    cancelarUpload();
    await carregarListaImportados();
    // Dispara recarga do dashboard na próxima vez que abrir
    window._dashboardPrecisaRecarregar = true;
  } catch (e) {
    console.error(e);
    mostrarToast('Erro ao salvar: ' + e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = '💾 Salvar no Firebase';
  }
}

// ===== LISTA DE IMPORTADOS =====
async function carregarListaImportados() {
  const lista = document.getElementById('lista-importados');
  try {
    const vendas = await listarVendas({ limite: 200 });
    datasImportadas = vendas.map(v => v.id);

    if (!vendas.length) {
      lista.innerHTML = `
        <div class="empty-state" style="box-shadow:none;padding:30px">
          <div class="empty-icon">📁</div>
          <h3>Nenhum dia importado ainda</h3>
          <p>Suba o primeiro TXT do PDV no bloco acima para começar.</p>
        </div>`;
      document.getElementById('sub-importados').textContent = '';
      return;
    }

    lista.innerHTML = vendas.map(v => `
      <div class="importado-item">
        <div class="importado-data">
          <div class="importado-dia">${fmtData(v.id)}</div>
          <div class="importado-dow">${diaSemana(v.id)}</div>
        </div>
        <div class="importado-info">
          <div class="importado-total">${fmtMoeda(v.totais?.total)}</div>
          <div class="importado-meta">
            ${fmtInt(v.totais?.qtd)} itens · ${(v.vendedores || []).length} vendedores
          </div>
        </div>
        <div class="importado-acoes">
          <button class="btn btn-ghost btn-sm" onclick="verDetalheVendas('${v.id}')">Ver detalhes</button>
        </div>
      </div>
    `).join('');
    document.getElementById('sub-importados').textContent = `${vendas.length} ${vendas.length === 1 ? 'dia' : 'dias'} no total`;
  } catch (e) {
    console.error(e);
    lista.innerHTML = `<div class="preview-err">Erro ao carregar: ${e.message}</div>`;
  }
}

// ===== AÇÕES GLOBAIS (chamadas do HTML) =====
window.verDetalheVendas = async function(dia) {
  const modal = document.getElementById('modal-contagem'); // reutilizando o modal
  const body  = document.getElementById('modal-body');
  body.innerHTML = `<div style="padding:40px;text-align:center"><span class="spinner"></span></div>`;
  modal.classList.add('open');

  try {
    const v = await buscarVendasDia(dia);
    if (!v) { body.innerHTML = '<div style="padding:20px">Dados não encontrados.</div>'; return; }

    const vendedoresHtml = (v.vendedores || [])
      .sort((a,b) => b.total - a.total)
      .map(vd => `
        <div class="det-linha">
          <span class="det-nome">${vd.nome}</span>
          <span class="det-valor">${fmtMoeda(vd.total)} <span class="det-qtd">(${fmtInt(vd.qtd)} itens)</span></span>
        </div>`).join('');

    const gruposHtml = (v.grupos || [])
      .sort((a,b) => b.total - a.total)
      .map(g => `
        <div class="det-linha">
          <span class="det-nome">${g.nome}</span>
          <span class="det-valor">${fmtMoeda(g.total)}</span>
        </div>`).join('');

    body.innerHTML = `
      <div class="modal-head">
        <h3>Vendas de ${fmtData(dia)}</h3>
        <p>${diaSemana(dia)} · Faturamento total: ${fmtMoeda(v.totais?.total)}</p>
      </div>
      <div class="items-detalhe">
        <h4 style="margin-bottom:8px;font-family:'Raleway',sans-serif">💰 Totais</h4>
        <div class="det-linha"><span>Subtotal</span><span class="det-valor">${fmtMoeda(v.totais?.subtotal)}</span></div>
        <div class="det-linha"><span>Acréscimos</span><span class="det-valor">${fmtMoeda(v.totais?.acrescimo)}</span></div>
        <div class="det-linha"><span>Descontos</span><span class="det-valor" style="color:var(--vermelho)">${fmtMoeda(v.totais?.desconto)}</span></div>
        <div class="det-linha" style="font-weight:800;border-top:2px solid var(--cinza-borda);margin-top:4px;padding-top:8px">
          <span>Total</span>
          <span class="det-valor" style="color:var(--vinho)">${fmtMoeda(v.totais?.total)}</span>
        </div>

        <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">👥 Vendedores</h4>
        ${vendedoresHtml || '<p class="text-muted">Sem vendedores.</p>'}

        ${v.operadores ? `
          <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">🖥️ OPERADORES</h4>
          <div class="det-linha">
            <span class="det-nome">OPERADORES</span>
            <span class="det-valor">${fmtMoeda(v.operadores.total)} <span class="det-qtd">(${fmtInt(v.operadores.qtd)} itens)</span></span>
          </div>
        ` : ''}

        <h4 style="margin-top:20px;margin-bottom:8px;font-family:'Raleway',sans-serif">📊 Grupos</h4>
        ${gruposHtml || '<p class="text-muted">Sem grupos.</p>'}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;color:var(--vermelho)">Erro: ${e.message}</div>`;
  }
};

// ===== UTILS =====
function diaSemana(yyyymmdd) {
  const [y,m,d] = yyyymmdd.split('-').map(Number);
  const data = new Date(y, m-1, d);
  const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  return dias[data.getDay()];
}

function mostrarToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + tipo;
  setTimeout(() => t.className = 'toast', 2800);
}
