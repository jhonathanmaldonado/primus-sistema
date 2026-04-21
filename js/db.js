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
 */
export async function listarContagens({ tipo, dataInicio, dataFim, limite = 100 } = {}) {
  let q = collection(db, COL_CONTAGENS);
  const filtros = [];
  if (tipo)       filtros.push(where('tipo', '==', tipo));
  if (dataInicio) filtros.push(where('data', '>=', dataInicio));
  if (dataFim)    filtros.push(where('data', '<=', dataFim));
  // Monta query
  q = filtros.length
    ? query(collection(db, COL_CONTAGENS), ...filtros, orderBy('data', 'desc'), limit(limite))
    : query(collection(db, COL_CONTAGENS), orderBy('data', 'desc'), limit(limite));
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

/**
 * Busca a contagem mais recente de um tipo e data (pra usar de "última contagem").
 */
export async function ultimaContagem({ tipo, data }) {
  const q = query(
    collection(db, COL_CONTAGENS),
    where('tipo', '==', tipo),
    where('data', '==', data),
    orderBy('criadoEm', 'desc'),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function excluirContagem(id) {
  await deleteDoc(doc(db, COL_CONTAGENS, id));
}

// ===== VENDAS (parseadas do TXT do PDV) =====

export async function salvarVendas(dia, dados) {
  // dia = 'YYYY-MM-DD', dados = { totais, vendedores, grupos, subgrupos, produtos, horas }
  await setDoc(doc(db, COL_VENDAS, dia), {
    ...dados,
    atualizadoEm: serverTimestamp()
  });
}

export async function buscarVendasDia(dia) {
  const snap = await getDoc(doc(db, COL_VENDAS, dia));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listarVendas({ dataInicio, dataFim, limite = 60 } = {}) {
  const filtros = [];
  if (dataInicio) filtros.push(where('__name__', '>=', dataInicio));
  if (dataFim)    filtros.push(where('__name__', '<=', dataFim));
  const q = filtros.length
    ? query(collection(db, COL_VENDAS), ...filtros, orderBy('__name__', 'desc'), limit(limite))
    : query(collection(db, COL_VENDAS), orderBy('__name__', 'desc'), limit(limite));
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
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
