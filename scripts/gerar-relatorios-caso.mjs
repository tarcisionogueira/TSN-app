// Gera os 3 relatórios (documental → mercadológico → laudo) de um CASO, em nome do cliente (15/10, dono: "pode
// gerar os relatórios do Rafael e do Matheus"). Para caso pós-arremate cujo lote não está no acervo: o lote do
// caso existe só como marcador ("Arremate atribuído pela equipe", sem tipo/área/cidade) e os documentos estão
// nos e-mails do caso (caso_documentos).
//
// Passos: (1) completa o lote SÓ onde está vazio (LOTE_JSON; o título-marcador é trocado); (2) liga ao lote os
// documentos do caso que o documental lê (matrícula, edital, escritura, auto, decisões) via imovel_anexos;
// (3) documental, que lê a matrícula; (4) tipo/área saem do que o documental LEU quando não vieram no LOTE_JSON
// (nunca chute de tipo: foi o defeito da Fazenda Tamboré); (5) mercadológico; (6) laudo.
// Chama as rotas com CRON_SECRET + paraUserId (mesmo caminho do regenerar-relatorios-cron: sem cota do cliente).
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET, CASO_ID, LOTE_JSON (opcional), SO (opcional:
// "documental,mercado,laudo"), BASE (padrão https://bidprobrasil.com.br).
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON = process.env.CRON_SECRET;
const BASE = process.env.BASE || 'https://bidprobrasil.com.br';
const CASO_ID = (process.env.CASO_ID || '').trim();
const SO = new Set((process.env.SO || 'documental,mercado,laudo').split(',').map((s) => s.trim()).filter(Boolean));
let LOTE = {};
try { LOTE = process.env.LOTE_JSON ? JSON.parse(process.env.LOTE_JSON) : {}; } catch (e) { console.error(`LOTE_JSON inválido: ${e.message}`); process.exit(2); }

if (!SUPABASE_URL || !KEY || !CRON) { console.error('faltam credenciais (Supabase/CRON_SECRET)'); process.exit(2); }
if (!/^[0-9a-f-]{36}$/i.test(CASO_ID)) { console.error('CASO_ID inválido'); process.exit(2); }

const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function ler(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr });
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const CAMPOS_LOTE = ['titulo', 'tipo', 'area_m2', 'endereco', 'bairro', 'cidade', 'estado', 'modalidade', 'leiloeiro', 'valor_minimo', 'valor_avaliacao', 'descricao', 'numero_processo'];
const TITULO_MARCADOR = /^arremate atribu[ií]do pela equipe$/i;

async function completarLote(id, valores) {
  const [atual] = await ler(`imoveis_leilao?id=eq.${id}&select=${CAMPOS_LOTE.join(',')}`);
  if (!atual) throw new Error(`lote ${id} não existe`);
  const patch = {};
  for (const k of CAMPOS_LOTE) {
    if (valores[k] == null || valores[k] === '') continue;
    const vazio = atual[k] == null || atual[k] === '' || (k === 'titulo' && TITULO_MARCADOR.test(atual[k]));
    if (vazio) patch[k] = valores[k];
  }
  if (!Object.keys(patch).length) return { ...atual, mudou: [] };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${id}`, { method: 'PATCH', headers: { ...hdr, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  const linhas = r.ok ? await r.json() : [];
  if (!linhas.length) throw new Error(`completar lote HTTP ${r.status}: ${r.ok ? 'nenhuma linha alterada' : (await r.text()).slice(0, 200)}`);
  return { ...linhas[0], mudou: Object.keys(patch) };
}

// Ordem de leitura: o documental lê no máx. 10 anexos manuais, e a matrícula/edital vêm primeiro.
const PRIORIDADE = ['matricula', 'edital', 'auto_arrematacao', 'carta_arrematacao', 'decisao_judicial', 'exigencia_cartorio', 'nota_devolucao', 'parecer_juridico', 'contrato', 'laudo'];
async function ligarDocumentos(imovelId, casoId) {
  const docs = await ler(`caso_documentos?caso_id=eq.${casoId}&grupo=eq.arrematacao&select=tipo,titulo,storage_path`);
  const existentes = await ler(`imovel_anexos?imovel_id=eq.${imovelId}&select=tipo,storage_path`);
  const ja = new Set(existentes.map((a) => a.storage_path).filter(Boolean));
  // Matrícula e edital: um por imóvel (índice único imovel_id+tipo). O que já foi anexado na atribuição vale.
  const tiposUnicos = new Set(existentes.map((a) => a.tipo).filter((t) => t === 'matricula' || t === 'edital'));
  const vistos = new Set();
  const novos = docs
    .filter((d) => PRIORIDADE.includes(d.tipo) && !ja.has(d.storage_path))
    .filter((d) => { if (d.tipo !== 'matricula' && d.tipo !== 'edital') return true; if (tiposUnicos.has(d.tipo)) return false; tiposUnicos.add(d.tipo); return true; })
    .sort((a, b) => PRIORIDADE.indexOf(a.tipo) - PRIORIDADE.indexOf(b.tipo))
    .filter((d) => { const k = `${d.tipo}|${d.titulo}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, Math.max(0, 10 - existentes.length))
    .map((d) => ({ imovel_id: imovelId, tipo: ['matricula', 'edital'].includes(d.tipo) ? d.tipo : 'outro', nome: String(d.titulo || d.tipo).slice(0, 200),
      storage_path: d.storage_path, arrematado: true, role_criador: 'sistema', descricao: 'Documento do caso (e-mails do escritório), ligado por gerar-relatorios-caso' }));
  if (!novos.length) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/imovel_anexos`, { method: 'POST', headers: { ...hdr, Prefer: 'return=representation' }, body: JSON.stringify(novos) });
  const gravados = r.ok ? await r.json() : [];
  if (gravados.length !== novos.length) throw new Error(`ligar documentos HTTP ${r.status}: ${r.ok ? 'gravou menos' : (await r.text()).slice(0, 200)}`);
  return gravados.length;
}

async function chamar(rota, corpo) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON }, body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { j = null; } // padrao-ok: resposta não-JSON é tratada logo abaixo pelo status
  const seg = Math.round((Date.now() - t0) / 1000);
  if (!r.ok || !j?.ok) throw new Error(`${rota} HTTP ${r.status} em ${seg}s: ${(j?.error || txt).slice(0, 300)}`);
  console.log(`ok  ${rota} em ${seg}s`);
  return j;
}

// Tipo e área pelo que o documental LEU. Sem sinal claro de construção, é terreno; sem área, fica sem área.
function tipoEAreaDoDocumental(result) {
  const ex = result?.extracao || {};
  const texto = JSON.stringify({ raioX: result?.raioX, parecer: result?.parecer, extracao: ex }).toLowerCase();
  const construcao = /\b(casa|sobrado|resid[eê]ncia|edifica[cç][aã]o|edificad|[aá]rea constru[ií]da|benfeitoria residencial)\b/.test(texto);
  const apto = /\bapartamento\b/.test(texto);
  const tipo = apto ? 'apartamento' : construcao ? 'casa' : 'terreno';
  const area = Number(ex.areaPrivativaM2) || Number(ex.areaTotalM2) || Number(ex.areaTerrenoM2) || null;
  return { tipo, area, areaTerreno: Number(ex.areaTerrenoM2) || null };
}

const [caso] = await ler(`casos?id=eq.${CASO_ID}&select=id,cliente_id,imovel_id,imovel_endereco,imovel_valor`);
if (!caso?.imovel_id || !caso?.cliente_id) { console.error('caso sem imóvel ou cliente'); process.exit(1); }
const imovelId = caso.imovel_id;
console.log(`caso ${CASO_ID} · imóvel ${imovelId} · cliente ${caso.cliente_id}`);

let lote = await completarLote(imovelId, LOTE);
console.log(`lote: ${lote.mudou.length ? `completado (${lote.mudou.join(', ')})` : 'já estava completo'}`);
console.log(`documentos ligados ao lote: ${await ligarDocumentos(imovelId, CASO_ID)}`);
const ident = () => ({ imovelId, paraUserId: caso.cliente_id, titulo: lote.titulo, cidade: lote.cidade, estado: lote.estado });

const falhas = [];
if (SO.has('documental')) {
  try { await chamar('gerar-documental', ident()); } catch (e) { falhas.push(e.message); console.error(`FALHOU ${e.message}`); }
}

if (SO.has('mercado')) {
  try {
    if (!lote.tipo || !lote.area_m2) {
      const [doc] = await ler(`analises_documental?imovel_id=eq.${imovelId}&user_id=eq.${caso.cliente_id}&status=eq.concluida&select=result&limit=1`);
      if (!doc) throw new Error('mercadológico precisa de tipo/área e não há documental concluído para lê-los');
      const lido = tipoEAreaDoDocumental(doc.result);
      console.log(`do documental: tipo ${lido.tipo}, área ${lido.area ?? '?'} m²`);
      lote = await completarLote(imovelId, { tipo: lido.tipo, area_m2: lido.area });
    }
    const area = Number(lote.area_m2) || 0;
    const valor = Number(lote.valor_minimo) || Number(caso.imovel_valor) || 0;
    const judicial = lote.modalidade === 'judicial';
    const mercadoInputs = {
      endereco: [lote.endereco, lote.bairro, `${lote.cidade}/${lote.estado}`].filter(Boolean).join(', '),
      cidade: lote.cidade, estado: lote.estado, tipoImovel: lote.tipo, areaM2: area,
      areaTerrenoM2: lote.tipo === 'terreno' ? area : 0, nomeCondominio: LOTE.nome_condominio || '',
    };
    // Métricas ficam vazias de propósito: o servidor recalcula com o valor de mercado que ELE achou.
    const parecerInputs = { cenario: 'À Vista', metricas: {}, d: {
      nome: lote.titulo, tipo: lote.tipo, areaM2: area, cidade: lote.cidade, estado: lote.estado, endereco: mercadoInputs.endereco,
      origem: judicial ? 'judicial' : 'extrajudicial', leiloeiro: lote.leiloeiro || '', valorArrematacao: valor,
      valorAvaliacao: Number(lote.valor_avaliacao) || 0, valorMercado: 0, valorLocacao: 0, objetivoCompra: 'investimento',
      somenteAVista: true, taxaLeiloeiroPercentual: judicial ? 5 : 0, itbiPercentual: 3, honorariosPercentual: 0,
      prazoVendaMeses: 12, prazoReformaMeses: lote.tipo === 'terreno' ? 0 : 3, nomeCondominio: mercadoInputs.nomeCondominio,
    } };
    await chamar('gerar-analise', { ...ident(), imovel: { id: imovelId, titulo: lote.titulo, tipo: lote.tipo, areaM2: area, cidade: lote.cidade, estado: lote.estado, modalidade: lote.modalidade }, mercadoInputs, parecerInputs });
  } catch (e) { falhas.push(e.message); console.error(`FALHOU ${e.message}`); }
}

if (SO.has('laudo')) {
  try { await chamar('gerar-laudo-viabilidade', ident()); } catch (e) { falhas.push(e.message); console.error(`FALHOU ${e.message}`); }
}

for (const t of ['analises_documental', 'analises_mercado', 'analises_laudo']) {
  const [r] = await ler(`${t}?imovel_id=eq.${imovelId}&user_id=eq.${caso.cliente_id}&select=status,updated_at,erro&limit=1`);
  console.log(`${t}: ${r ? `${r.status} (${r.updated_at})${r.erro ? ` erro: ${String(r.erro).slice(0, 160)}` : ''}` : 'não existe'}`);
}
if (falhas.length) process.exit(1);
