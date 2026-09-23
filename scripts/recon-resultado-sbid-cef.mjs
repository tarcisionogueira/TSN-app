/**
 * RECON — de onde tirar o RESULTADO do leilão (vendido / sem lance) na SUPERBID e na CEF.
 * 23/09/2026. Só LÊ e imprime — não grava nada. Roda no GitHub Actions (o sandbox de dev é
 * bloqueado para os dois domínios).
 *
 * SUPERBID: a página /oferta/<id> é montada no navegador (o cron de apuração, com fetch, vê
 * "sem conteúdo": 2.168 veículos vencidos, ZERO apurados). Hipótese: a API JSON que o coletor
 * já usa (offer-query.superbid.net) informa o status de oferta ENCERRADA. Testa searchType
 * opened/closed/(nenhum) filtrando pelo id, e imprime todo campo com cara de resultado.
 *
 * CEF: o recon de edital (03/08) provou que o Radware da Caixa separa CLIENTE pela assinatura
 * TLS — node:https passa, fetch cai no CAPTCHA. O cron de apuração usa fetch. Aqui: a página
 * de detalhe de imóveis que SUMIRAM do CSV depois do leilão, lida com os DOIS clientes, e o
 * texto que ela mostra (vendido? indisponível?).
 *
 * Env: SBID_IDS (vírgula), CEF_NUMS (vírgula).
 */
import https from 'https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SBID = (process.env.SBID_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const CEF = (process.env.CEF_NUMS || '').split(',').map(s => s.trim()).filter(Boolean);
const RE_RESULTADO = /status|situa|vend|sold|winner|vencedor|arremat|lance|bid|closed|encerr|deserto|licitant/i;
const linha = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);

function getHttps(url, hops = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 4) {
        res.resume(); return getHttps(new URL(res.headers.location, url).toString(), hops + 1).then(resolve);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, texto: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, texto: '', erro: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, texto: '', erro: e.message }));
  });
}
async function getFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' }, signal: AbortSignal.timeout(30000) });
    return { status: r.status, texto: await r.text() };
  } catch (e) { return { status: 0, texto: '', erro: e.message }; }
}
function camposResultado(obj, caminho = '', saida = []) {
  if (saida.length > 60) return saida;
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) camposResultado(v, caminho ? `${caminho}.${k}` : k, saida);
  } else if (obj !== null && obj !== undefined && RE_RESULTADO.test(caminho.split('.').slice(-2).join('.'))) {
    saida.push(`${caminho} = ${String(obj).slice(0, 80)}`);
  }
  return saida;
}
const semTags = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

async function reconSuperbid(id) {
  linha(`SUPERBID oferta ${id}`);
  for (const st of ['opened', 'closed', '']) {
    const url = `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&timeZoneId=America/Sao_Paulo${st ? `&searchType=${st}` : ''}&filter=id:${id}&pageNumber=1&pageSize=5`;
    const r = await getFetch(url);
    let j = null; try { j = JSON.parse(r.texto); } catch { /* não-JSON: imprime o começo abaixo */ }
    const lista = j ? (j.offers || j.content || j.results || j.items || (Array.isArray(j) ? j : [])) : [];
    console.log(`API searchType=${st || '(nenhum)'} → HTTP ${r.status} · ${j ? `${lista.length} oferta(s)` : `não-JSON: ${r.texto.slice(0, 120)}`}${r.erro ? ` · ${r.erro}` : ''}`);
    const of = lista.find(o => String(o?.id) === String(id)) || lista[0];
    if (of) camposResultado(of).forEach(l => console.log('   ' + l));
  }
  // Página pública (o que o cron de apuração lê hoje)
  const p = await getFetch(`https://www.superbid.net/oferta/${id}`);
  const txt = semTags(p.texto);
  console.log(`PÁGINA → HTTP ${p.status} · html=${p.texto.length} · texto=${txt.length}${p.erro ? ` · ${p.erro}` : ''}`);
  const trechos = [...txt.matchAll(/.{0,60}(vendid|arrematad|encerrad|sem lance|sem licitante|deserto|lance vencedor|maior lance).{0,60}/gi)].slice(0, 5).map(m => m[0]);
  console.log('   trechos: ' + JSON.stringify(trechos));
  const nd = p.texto.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) { try { camposResultado(JSON.parse(nd[1])).slice(0, 25).forEach(l => console.log('   NEXT ' + l)); } catch { console.log('   __NEXT_DATA__ ilegível'); } }
}

async function reconCef(num) {
  linha(`CEF imóvel ${num}`);
  const url = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${num}`;
  for (const [nome, fn] of [['node:https', getHttps], ['fetch', getFetch]]) {
    const r = await fn(url);
    const captcha = /Radware|BotManager|__uzdbm_|Bot Manager CAPTCHA/i.test(r.texto);
    const txt = semTags(r.texto);
    console.log(`${nome} → HTTP ${r.status} · html=${r.texto.length} · captcha=${captcha}${r.erro ? ` · ${r.erro}` : ''}`);
    const trechos = [...txt.matchAll(/.{0,80}(vendid|n[ãa]o (est[áa] )?dispon|indispon|encerrad|arrematad|n[ãa]o encontrad|sem licitante|deserto|suspens).{0,80}/gi)].slice(0, 5).map(m => m[0]);
    console.log('   trechos: ' + JSON.stringify(trechos));
    if (!trechos.length) console.log('   início do texto: ' + txt.slice(0, 300));
  }
}

for (const id of SBID) await reconSuperbid(id);
for (const n of CEF) await reconCef(n);
