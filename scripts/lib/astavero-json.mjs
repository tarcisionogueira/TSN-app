/**
 * Parser puro — plataforma ASTAVERO (backend Angular + API JSON própria, multi-tenant). Recon 05/10
 * (pendência #41): o recon de 13/09 achou `/app/lotes` e concluiu "responde 403 sem sessão" — testava
 * GET com querystring. O bundle (`main.*.js`) mostra que é **POST com corpo JSON** (`home.nav`), e
 * assim responde 200 sem login, sem cookie, sem Cloudflare. Mesmo backend em 5 leiloeiros (abaixo).
 *
 *  - LISTAGEM  POST /app/lotes        {botao:'ABERTOS', categoria:'Imóveis', uf:'', cidade:'', …}
 *              → { lotes:[{id, leilao, lote, nome, local:'Cidade - UF', valor, avaliacao, praca,
 *                  data, status, vara, origem, image, url}], pag:{count}, categorias:[…] }
 *  - LEILÃO    POST /app/pregao/init  {id: <leilão>, …} — SEM `id` nunca responde; o `lote` que vem junto é o 1º
 *              do leilão, não o pedido (medido) — daqui só se usa `leilao` (datas d1/d2, anexos/edital).
 *  - LOTE      POST /app/pregao/lote  {id: <lote>} — o lote certo.
 *              → { leilao:{datas:{d1,d2,…}, anexos:[{url, private, type}]}, lote:{v:{avaliacao,
 *                  primeira, segunda}, p:{processo, vara, tipo, falencia}, d:{cidade, uf, bairro,
 *                  endereco, cep}, nome, detalhada(HTML), status} }
 */
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';

export const TENANTS = [
  { fonte: 'DAMIANILEILOES', leiloeiro: 'Damiani Leilões', base: 'https://www.damianileiloes.com.br' },
  { fonte: 'MAZZOLLILEILOES', leiloeiro: 'Mazzolli Leilões', base: 'https://www.mazzollileiloes.com.br' },
  { fonte: 'FBLEILOES', leiloeiro: 'FB Leilões', base: 'https://www.fbleiloes.com.br' },
  { fonte: 'DBSLEILOES', leiloeiro: 'DBS Leilões', base: 'https://www.dbsleiloes.com.br' },
  { fonte: 'SAULOJULIOLEILOEIRO', leiloeiro: 'Saulo Júlio Leiloeiro', base: 'https://www.saulojulioleiloeiro.com.br' },
];

export const CORPO_LISTAGEM = { botao: 'ABERTOS', categoria: 'Imóveis', uf: '', cidade: '', varacomitente: '', f: '' };

const texto = (html) => decodificarEntidades(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const reais = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1000 ? Math.round(n * 100) / 100 : 0; };
const UF_RE = /^[A-Z]{2}$/;

export function localDaListagem(local) {
  const m = String(local || '').match(/^(.+?)\s*[-/]\s*([A-Z]{2})\s*$/);
  return m ? { cidade: m[1].trim(), estado: m[2] } : { cidade: null, estado: null };
}

const TIPO = [[/apart|flat|kitnet|cobertura|\bapto\b/i, 'apartamento'], [/casa|sobrado|resid[êe]ncia/i, 'casa'],
  [/fazenda|s[íi]tio|ch[áa]cara|gleba|rural/i, 'rural'],
  [/sala|loja|galp[ãa]o|barrac[ãa]o|pr[ée]dio|comercial|industrial|box|garagem/i, 'comercial'],
  [/terreno|lote\b|[áa]rea/i, 'terreno']];
export const tipoDe = (txt) => TIPO.find(([re]) => re.test(txt))?.[1] || 'imovel';

/** Linha de imoveis_leilao a partir do item da listagem + resposta de /app/pregao/init (ou null). */
export function montarRowAstavero(item, det, tenant) {
  const lote = det?.lote || {};
  const leilao = det?.leilao || {};
  const v = lote.v || {};
  const p = lote.p || {};
  const d = lote.d || {};
  const titulo = String(lote.nome || item.nome || '').replace(/^Lote\s+[\w.]+\s*-\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const descricao = texto(lote.detalhada).slice(0, 8000) || titulo;
  const daLista = localDaListagem(item.local);
  const estado = UF_RE.test(String(d.uf || '')) ? d.uf : daLista.estado;
  const cidade = String(d.cidade || '').trim() || daLista.cidade;
  const primeira = reais(v.primeira) || reais(item.praca === 1 ? item.valor : 0);
  const segunda = reais(v.segunda);
  const avaliacao = Math.max(reais(v.avaliacao), reais(item.avaliacao), primeira);
  // Praça vigente: 2ª quando a listagem já diz praça 2 — o lance que vale hoje é o dela.
  const minimo = item.praca === 2 && segunda ? segunda : (primeira || reais(item.valor));
  const datas = leilao.datas || {};
  const anexos = (Array.isArray(leilao.anexos) ? leilao.anexos : []).concat(Array.isArray(lote.anexos) ? lote.anexos : [])
    .filter((a) => a && !a.private && /^https?:\/\//.test(a.url || ''))
    .map((a) => ({ tipo: /edital/i.test(a.arquivo || a.url) ? 'edital' : /matr[íi]cula/i.test(a.arquivo || a.url) ? 'matricula' : 'outro',
      nome: /edital/i.test(a.arquivo || a.url) ? 'Edital' : /matr[íi]cula/i.test(a.arquivo || a.url) ? 'Matrícula' : 'Documento', url: a.url }));
  // Com processo/vara é JUDICIAL — "Execução de Título Extrajudicial" é uma ação na Justiça; a palavra
  // "extrajudicial" no tipo da ação não muda a natureza do leilão (o teste com o lote real pegou isso).
  const judicial = !!(p.processo || p.vara || item.vara) || !/aliena[cç][aã]o\s+fiduci|extrajudicial/i.test(descricao.slice(0, 2000));
  const row = {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${item.id}`,
    titulo: titulo || `Imóvel ${tenant.leiloeiro} ${item.lote || item.id}`,
    tipo: tipoDe(`${titulo} ${descricao.slice(0, 600)}`),
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    cidade: cidade || null, estado: estado || null,
    bairro: String(d.bairro || '').trim(),
    endereco: String(d.endereco || '').length <= 200 ? String(d.endereco || '').trim() : '',
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: item.praca === 2 ? null : (segunda || null),
    area_m2: extrairAreaM2(`${titulo} ${descricao}`) || 0,
    descricao,
    numero_processo: p.processo || null,
    numero_matricula: (descricao.match(/matr[íi]cul\w*\s+(?:sob\s+(?:o\s+)?)?(?:n[º°.o]?\s*)?([\d.]{3,})/i) || [])[1]?.replace(/\./g, '') || null,
    url_lote: item.url || `${tenant.base}/pregao/${item.leilao}/${item.id}`,
    leiloeiro: tenant.leiloeiro,
    data_leilao: datas.d1 || item.data || null,
    data_leilao_2: datas.d2 || null,
    forma_pagamento: 'a_vista', ativo: true, suprimido_motivo: null, atualizado_em: new Date().toISOString(),
  };
  if (d.cep && /^\d{5}-?\d{3}$/.test(String(d.cep))) row.cep = String(d.cep).replace('-', '');
  if (item.image) { row.link_foto = item.image; row.fotos = [item.image]; }
  if (anexos.length) {
    row.anexos = anexos;
    row.link_edital = anexos.find((a) => a.tipo === 'edital')?.url || null;
    row.link_matricula = anexos.find((a) => a.tipo === 'matricula')?.url || null;
  }
  if (avaliacao > 0 && minimo > 0) row.desconto_percentual = Math.max(0, Math.round((1 - minimo / avaliacao) * 100));
  return row;
}
