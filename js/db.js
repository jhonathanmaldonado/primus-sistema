// ===== DB — PRIMUS =====
// Funções de alto nível para salvar/buscar contagens, vendas, etc.

import {
  db,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp
} from './firebase-config.js';

// ===== NOMES DAS COLEÇÕES =====
// Todas prefixadas com 'primus_' para não conflitar com outros sistemas.
const COL_CONTAGENS = 'primus_contagens';
const COL_VENDAS    = 'primus_vendas';
const COL_COMPRAS   = 'primus_compras';
const COL_PRODUTOS  = 'primus_produtos';

// ===== CONTAGENS =====

/**
 * Salva uma contagem no Firestore.
 * @param {object} contagem - { tipo: 'ini'|'fin'|'sorv', data: 'YYYY-MM-DD', autor: {id,nome,perfil}, itens: {...} }
 */
export async function salvarContagem(contagem) {
  const ref = await addDoc(collection(db, COL_CONTAGENS), {
    tipo: contagem.tipo,
    data: contagem.data,
    autorId: contagem.autor.id,
    autorNome: contagem.autor.nome,
    autorPerfil: contagem.autor.perfil,
    itens: contagem.itens,
    criadoEm: serverTimestamp()
  });
  return ref.id;
}

/**
 * Lista contagens com filtros opcionais.
 * NOTA: busca todos os documentos e filtra/ordena em JS para evitar
 * necessidade de índices compostos. Em volume normal (até ~5000 contagens),
 * isso é perfeitamente aceitável.
 */
export async function listarContagens({ tipo, dataInicio, dataFim, limite = 500 } = {}) {
  const snap = await getDocs(collection(db, COL_CONTAGENS));
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
  // Ordena por data (desc) e depois por criadoEm (desc)
  arr.sort((a, b) => {
    if (a.data !== b.data) return b.data.localeCompare(a.data);
    // Se mesma data, o mais recente (criadoEm) primeiro
    const aMs = a.criadoEm?.toMillis?.() || 0;
    const bMs = b.criadoEm?.toMillis?.() || 0;
    return bMs - aMs;
  });
  // Aplica filtros em JS
  let filtrado = arr;
  if (tipo)       filtrado = filtrado.filter(c => c.tipo === tipo);
  if (dataInicio) filtrado = filtrado.filter(c => c.data >= dataInicio);
  if (dataFim)    filtrado = filtrado.filter(c => c.data <= dataFim);
  return filtrado.slice(0, limite);
}

/**
 * Busca a contagem mais recente de um tipo e data (pra usar de "última contagem").
 */
export async function ultimaContagem({ tipo, data }) {
  // Busca todas e filtra em JS para evitar precisar de índice composto
  const snap = await getDocs(collection(db, COL_CONTAGENS));
  const arr = [];
  snap.forEach(d => {
    const dt = d.data();
    if (dt.tipo === tipo && dt.data === data) {
      arr.push({ id: d.id, ...dt });
    }
  });
  if (!arr.length) return null;
  arr.sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
  return arr[0];
}

export async function excluirContagem(id) {
  await deleteDoc(doc(db, COL_CONTAGENS, id));
}

// ===== VENDAS (parseadas do TXT do PDV) =====

/**
 * Salva vendas de um dia. Sobrescreve se já existir.
 * @param {string} dia - 'YYYY-MM-DD'
 * @param {object} dados - { totais, vendedores, grupos, subgrupos, produtos, horas, operadores }
 */
export async function salvarVendas(dia, dados) {
  // dia = 'YYYY-MM-DD', dados = { totais, vendedores, grupos, subgrupos, produtos, horas, operadores }
  await setDoc(doc(db, COL_VENDAS, dia), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function buscarVendasDia(dia) {
  const snap = await getDoc(doc(db, COL_VENDAS, dia));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Salva o detalhamento Vendedor × Produto num dia que já tem vendas importadas.
 * Mescla com o documento existente (preserva todos os outros campos).
 * @param {string} dia - 'YYYY-MM-DD'
 * @param {array} detalhado - array de { nome, totalQtd, total, produtos }
 */
export async function salvarDetalhadoVxP(dia, detalhado) {
  const existente = await buscarVendasDia(dia);
  if (!existente) {
    throw new Error(`Não há vendas importadas pro dia ${dia}. Suba primeiro o relatório geral.`);
  }
  // Remove o campo "id" que vem da leitura antes de gravar
  const { id, ...dados } = existente;
  await setDoc(doc(db, COL_VENDAS, dia), {
    ...dados,
    vendedoresDetalhado: detalhado,
    detalhadoAtualizadoEm: serverTimestamp()
  });
}

/**
 * Lista vendas ordenadas por data (mais recente primeiro).
 * Pode filtrar por período.
 * NOTA: busca todos os documentos e filtra/ordena em JS para evitar
 * necessidade de índices compostos no Firestore. Como cada doc é um dia,
 * em 1 ano são no máximo ~365 docs — perfeitamente aceitável.
 */
export async function listarVendas({ dataInicio, dataFim, limite = 365 } = {}) {
  const snap = await getDocs(collection(db, COL_VENDAS));
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
  // Ordena por ID (que é a data YYYY-MM-DD), mais recente primeiro
  arr.sort((a, b) => b.id.localeCompare(a.id));
  // Filtra período se especificado
  let filtrado = arr;
  if (dataInicio) filtrado = filtrado.filter(v => v.id >= dataInicio);
  if (dataFim)    filtrado = filtrado.filter(v => v.id <= dataFim);
  // Aplica limite
  return filtrado.slice(0, limite);
}

/**
 * Lista apenas os IDs (datas) de vendas já importadas - útil pra detectar duplicatas.
 */
export async function listarDatasVendas() {
  const snap = await getDocs(collection(db, COL_VENDAS));
  const arr = [];
  snap.forEach(d => arr.push(d.id));
  arr.sort((a, b) => b.localeCompare(a));
  return arr;
}

// ===== LISTA DE COMPRAS =====

export async function salvarListaCompras(id, dados) {
  await setDoc(doc(db, COL_COMPRAS, id), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function buscarListaCompras(id) {
  const snap = await getDoc(doc(db, COL_COMPRAS, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ===== UTIL =====

/** Converte YYYY-MM-DD para objeto Date (local, não UTC) */
export function parseData(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Converte Date para YYYY-MM-DD (local) */
export function formatarData(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Data de hoje (local) como YYYY-MM-DD */
export function hoje() {
  return formatarData(new Date());
}
