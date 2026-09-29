/**
 * ENDEREÇO A PARTIR DO TEXTO JÁ GRAVADO — 29/09 (passo 3 do plano de localização, pedido do dono).
 *
 * 1.753 terrenos/rurais ativos estão com o pino no CENTRO DA CIDADE (`geocod_nivel='cidade'`) —
 * 99% deles com `situacao_geo='indeterminada'`, então o mercadológico não sabe se é urbano ou
 * rural e não pede comparável da vizinhança. 789 DIZEM o logradouro no título/descrição
 * ("Rua X, nº 120", "Estrada Municipal Y") e só 122 têm `endereco` gravado: o trigger
 * `preservar_e_derivar_endereco` só olha o TÍTULO. Custo zero: relê o texto do banco com o
 * extrator de endereço que já existe (`extrairEnderecoMatricula`), grava `endereco`/`cep` só onde
 * estão vazios e marca `geocod_nivel='refazer'` — o cron do geocodificador faz o resto (com
 * logradouro+número ele pode usar o Google dentro do teto grátis, ver api/geocodificar.js).
 *
 * Travas (texto de leilão cita outros endereços):
 *  · município citado no texto tem de ser o do lote (senão é o fórum/cartório/outro imóvel);
 *  · logradouro perto de "leiloeiro/escritório/auditório/sede" é do LEILOEIRO → recusa;
 *  · mais de um logradouro distinto no texto → não sabe qual → recusa;
 *  · CEP só se houver UM distinto.
 * EM SECO por padrão (forma nº 10); END_APLICAR=1 grava. END_LIMITE (padrão 3000).
 */
import { enderecoDoTexto } from './lib/endereco-do-texto.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.END_APLICAR === '1';
const LIMITE = Number(process.env.END_LIMITE || 3000);
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function todas(path) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const pag = await sb(`${path}&limit=1000&offset=${de}`);
    out.push(...pag);
    if (pag.length < 1000) return out;
  }
}

const alvo = (await todas('imoveis_leilao?ativo=eq.true&tipo=in.(terreno,rural)&geocod_nivel=eq.cidade&or=(endereco.is.null,endereco.eq.)&select=id,fonte,tipo,cidade,estado,titulo,descricao,cep&order=id')).slice(0, LIMITE);
const motivos = {}; let achou = 0, gravou = 0, comNumero = 0, comCep = 0;
for (const im of alvo) {
  const r = enderecoDoTexto(`${im.titulo || ''}. ${im.descricao || ''}`, im.cidade);
  if (!r.endereco) { motivos[r.motivo] = (motivos[r.motivo] || 0) + 1; continue; }
  achou++;
  if (/\d/.test(r.endereco)) comNumero++;
  const patch = { endereco: r.endereco.slice(0, 200), geocod_nivel: 'refazer' };
  if (r.cep && !im.cep) { patch.cep = r.cep; comCep++; }
  if (!APLICAR) { if (achou <= 40) console.log(`  [seco] ${im.fonte}/${im.tipo} ${im.cidade}/${im.estado} → ${patch.endereco}${patch.cep ? ` · CEP ${patch.cep}` : ''}`); continue; }
  const up = await sb(`imoveis_leilao?id=eq.${im.id}&or=(endereco.is.null,endereco.eq.)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) })
    .catch((e) => { console.error(`  falhou ${im.id}: ${e.message}`); return null; });
  if (Array.isArray(up) && up.length === 1) gravou++;
}
console.log(`[endereco-da-descricao] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${alvo.length} terrenos/rurais com pino na cidade e sem endereço · ${achou} com logradouro no texto (${comNumero} com número, ${comCep} com CEP) · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
