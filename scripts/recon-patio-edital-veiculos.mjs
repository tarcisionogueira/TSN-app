/**
 * MEDIÇÃO (05/11, pedido do dono): quantos veículos SEM pátio confirmado o EDITAL resolveria?
 *
 * Os leiloeiros da plataforma Degrau quase nunca escrevem a situação do pátio na descrição do lote
 * (114 de 138 vieram "indefinido" em 05/11). Em leilão judicial isso costuma estar no edital
 * ("removido ao pátio", "depositado com o executado"). Este script NUNCA grava: baixa cada edital
 * uma vez (camada de texto do PDF, sem IA), aplica o MESMO classificador da descrição
 * (lib/patio-veiculo.mjs) e imprime, por veículo, o que o edital diria — no TRECHO do lote (perto
 * da placa / do modelo) e no edital INTEIRO, que vale para o evento todo e pode misturar lotes.
 * O trecho é o que conta; o inteiro só aparece para mostrar quando ele discordaria.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; RECON_FONTES (csv, opcional; padrão: os leiloeiros da plataforma
 * Degrau — o 1º seco, sem filtro de fonte, pegou 1.000 veículos de todas as fontes e respondeu outra pergunta).
 */
import { carregarPDFParse } from '../api/_pdf-safe.js';
import { classificarPatio } from './lib/patio-veiculo.mjs';
import { TENANTS } from './lib/leilaoeletronico-parse.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
const MAX_BYTES = 15 * 1024 * 1024;

const PDFParse = await carregarPDFParse();
if (!PDFParse) { console.error('pdf-parse indisponível'); process.exit(1); }

const FONTES = (process.env.RECON_FONTES || Object.values(TENANTS).map((t) => t.fonte).join(',')).split(',').map((x) => x.trim()).filter(Boolean);
const r = await fetch(`${SB_URL}/rest/v1/veiculos_leilao?select=id,fonte,titulo,placa,modelo,anexos,status_patio&ativo=eq.true&status_patio=neq.confirmado&fonte=in.(${FONTES.join(',')})&limit=2000`,
  { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(30000) });
if (!r.ok) { console.error(`não consegui ler os veículos: HTTP ${r.status}`); process.exit(2); }
const veiculos = await r.json();

const editalDe = (v) => (Array.isArray(v.anexos) ? v.anexos : []).find((a) => a?.url && (a.tipo === 'edital' || /edital/i.test(a.nome || '')))?.url || null;

const cache = new Map();
async function textoDe(url) {
  if (cache.has(url)) return cache.get(url);
  let out;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, signal: AbortSignal.timeout(40000) });
    if (!resp.ok) out = { erro: `http_${resp.status}` };
    else {
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) out = { erro: 'tamanho' };
      else if (buf.subarray(0, 5).toString() !== '%PDF-') out = { erro: 'nao_e_pdf' };
      else {
        const p = new PDFParse({ data: buf });
        try {
          const texto = String((await p.getText())?.text || '').replace(/\s+/g, ' ');
          out = texto.replace(/\s/g, '').length < 200 ? { erro: 'sem_camada_de_texto (escaneado — só com IA)' } : { texto };
        } finally { await p.destroy().catch(() => {}); }
      }
    }
  } catch (e) { out = { erro: `excecao:${String(e?.message || e).slice(0, 60)}` }; }
  cache.set(url, out);
  return out;
}

// Trecho do lote dentro do edital: ±1.500 caracteres em volta da placa; sem placa, em volta do modelo.
function trechoDoLote(texto, v) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const placa = String(v.placa || '').replace(/[^A-Z0-9]/gi, '');
  const alvos = [
    placa.length >= 7 ? new RegExp(placa.split('').join('[\\s-]?'), 'i') : null,
    v.modelo && String(v.modelo).trim().length >= 3 ? new RegExp(esc(String(v.modelo).trim()).replace(/\s+/g, '\\s+'), 'i') : null,
  ].filter(Boolean);
  for (const re of alvos) {
    const m = texto.match(re);
    if (m) return texto.slice(Math.max(0, m.index - 1500), m.index + 1500);
  }
  return null;
}

const tot = { veiculos: veiculos.length, sem_edital: 0, edital_ilegivel: 0, lote_nao_achado: 0 };
const porStatus = {};
const erros = {};
for (const v of veiculos) {
  const url = editalDe(v);
  if (!url) { tot.sem_edital++; continue; }
  const { texto, erro } = await textoDe(url);
  if (!texto) { tot.edital_ilegivel++; const k = `${v.fonte} ${erro}`; erros[k] = (erros[k] || 0) + 1; continue; }
  const trecho = trechoDoLote(texto, v);
  const inteiro = classificarPatio(texto);
  if (!trecho) tot.lote_nao_achado++;
  const doLote = trecho ? classificarPatio(trecho) : null;
  const decide = doLote || inteiro;
  const chave = `${trecho ? 'trecho' : 'inteiro'}:${decide.status}`;
  porStatus[chave] = (porStatus[chave] || 0) + 1;
  console.log(`${v.fonte.padEnd(20)} ${String(v.titulo || '').slice(0, 50).padEnd(50)} hoje=${v.status_patio} → edital ${trecho ? 'trecho' : 'INTEIRO'}=${decide.status}${doLote && doLote.status !== inteiro.status ? ` (inteiro diria ${inteiro.status})` : ''}`);
}

console.log('\n=== RESUMO (nada foi gravado) ===');
console.log(JSON.stringify({ ...tot, editais_distintos_lidos: cache.size, por_resultado: porStatus, editais_ilegiveis_por_motivo: erros }, null, 2));
const confirmaria = (porStatus['trecho:confirmado'] || 0) + (porStatus['inteiro:confirmado'] || 0);
const excluiria = (porStatus['trecho:excluido'] || 0) + (porStatus['inteiro:excluido'] || 0);
console.log(`→ o edital confirmaria o pátio de ${confirmaria} veículo(s) e tiraria ${excluiria} (bem com o executado), de ${veiculos.length} sem pátio confirmado.`);
