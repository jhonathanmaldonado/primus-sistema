// ===== CATÁLOGO DE PRODUTOS — PRIMUS =====
// Centraliza todos os produtos em um só lugar.
// Usado por: contagem, lista de compras, dashboard.

export const BEBIDAS = [
  { nome:'Louvada Primus',              grupo:'🍺 Cervejas' },
  { nome:'Heineken 600ml',              grupo:'🍺 Cervejas' },
  { nome:'Original',                    grupo:'🍺 Cervejas' },
  { nome:'Heineken Zero Long Neck',     grupo:'🍺 Cervejas' },
  { nome:'Louvada German Longneck',     grupo:'🍺 Cervejas' },
  { nome:'Louvada German 500',          grupo:'🍺 Cervejas' },
  { nome:'Stella SG Longneck',          grupo:'🍺 Cervejas' },
  { nome:'Louvada Hop Zero',            grupo:'🍺 Cervejas' },
  { nome:'Coca Cola KS',                grupo:'🔷 Refrigerantes KS', ks:true },
  { nome:'Coca Cola KS Zero',           grupo:'🔷 Refrigerantes KS', ks:true },
  { nome:'Fanta Laranja KS',            grupo:'🔷 Refrigerantes KS', ks:true },
  { nome:'Sprite KS',                   grupo:'🔷 Refrigerantes KS', ks:true },
  { nome:'Kuat KS',                     grupo:'🔷 Refrigerantes KS', ks:true },
  { nome:'Coca Cola 1L',                grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Guaraná 1L',                  grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Coca Zero 1L',                grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Coca Cola Lata',              grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Coca Cola Zero Lata',         grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Sprite Lata',                 grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Guaraná Lata',                grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Fanta Laranja Lata',          grupo:'🥤 Refrigerantes', saindo:true },
  { nome:'Água Tônica',                 grupo:'💧 Especiais' },
  { nome:'Água Tônica Zero',            grupo:'💧 Especiais' },
  { nome:'Schweppes Citrus',            grupo:'💧 Especiais' },
  { nome:'Sprite Lemon Fresch',         grupo:'💧 Especiais' },
  { nome:'Água Prata Com Gás',          grupo:'💧 Águas' },
  { nome:'Água Prata Sem Gás',          grupo:'💧 Águas' },
  { nome:'Água Premium Com Gás',        grupo:'💧 Águas' },
  { nome:'Água Premium Sem Gás',        grupo:'💧 Águas' },
  { nome:'Kombucha Guaraná',            grupo:'🌿 Kombuchas' },
  { nome:'Kombucha Morango',            grupo:'🌿 Kombuchas' },
  { nome:'Kombucha de Limão',           grupo:'🌿 Kombuchas' },
  { nome:'Cappuccino',                  grupo:'☕ Cafés' },
  { nome:'Café Ameno',                  grupo:'☕ Cafés' },
  { nome:'Café Forza',                  grupo:'☕ Cafés' },
  { nome:'Café Gourmet',                grupo:'☕ Cafés' },
  { nome:'Suco Acerola 500ml',          grupo:'🧃 Sucos 500ml' },
  { nome:'Suco Abacaxi Hort. 500ml',    grupo:'🧃 Sucos 500ml' },
  { nome:'Suco Maracujá 500ml',         grupo:'🧃 Sucos 500ml' },
  { nome:'Suco Morango 500ml',          grupo:'🧃 Sucos 500ml' },
];

export const SORVETES = [
  { nome:'Sorbet Moranja',                  grupo:'🍨 Sorbets' },
  { nome:'Sorbet Manga+Maracujá',           grupo:'🍨 Sorbets' },
  { nome:'Sorbet Frutas Vermelhas',         grupo:'🍨 Sorbets' },
  { nome:'Gelato Doce de Leite',            grupo:'🍦 Gelatos' },
  { nome:'Gelato Chocolatudo',              grupo:'🍦 Gelatos' },
  { nome:'Gelato Iogurte+Frutas Amarelas',  grupo:'🍦 Gelatos' },
  { nome:'Gelato Cacau com Laranja 0%',     grupo:'🍦 Gelatos' },
  { nome:'Gelato Ninho Trufado',            grupo:'🍦 Gelatos' },
  { nome:'Gelato Paçoca Proteica',          grupo:'🍦 Gelatos' },
  { nome:'Chocolate Proteico',              grupo:'🍦 Gelatos' },
  { nome:'Gelato Cookie e Crean Proteico',  grupo:'🍦 Gelatos' },
  { nome:'Embalagem P',                     grupo:'📦 Embalagens' },
  { nome:'Embalagem M',                     grupo:'📦 Embalagens' },
  { nome:'Embalagem G',                     grupo:'📦 Embalagens' },
  { nome:'Kit Festa',                       grupo:'📦 Embalagens' },
  { nome:'Espátula Descartável',            grupo:'📦 Embalagens' },
];

// Util: cria slug para usar como ID de campo (mesma lógica do contagem_primus.html original)
export function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
