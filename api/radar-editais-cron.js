/**
 * /api/radar-editais-cron — Radar de Editais (CNJ). Monitora editais de leilão de imóvel
 * publicados no DJEN (Diário de Justiça Eletrônico Nacional) via a API pública "Comunica"
 * do CNJ, para TJSP e TRT-15 (SP). Popula public.editais_leilao (dedup por djen_id).
 *
 * Objetivo: saber o quanto antes quando sai um edital novo e a QUAL LEILOEIRO foi designado
 * (amplia acervo + controle). Ver docs/RADAR_EDITAIS_CNJ.md.
 *
 * Fonte: GET https://comunicaapi.pje.jus.br/api/v1/comunicacao (pública, sem token, diária).
 * ROBUSTO/ADITIVO: se o endpoint bloquear/mudar (o CNJ pode impor rate-limit/auth sem aviso),
 * loga o erro em monitor_runs e retorna 200 sem quebrar nada. Autorizado por CRON_SECRET.
 *
 * ⚠️ VALIDAÇÃO: o proxy do ambiente de dev bloqueia *.pje.jus.br (403); em produção (Vercel)
 * o egresso é aberto. Conferir o 1º run em monitor_runs (itens_vistos > 0).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const DJEN_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
// Tribunais monitorados — CONFIGURÁVEL por env RADAR_TRIBUNAIS (Item 5: "todos os estados").
// Default = SP (validar primeiro). Para abrir p/ o Brasil, setar a env, ex.:
//   TJSP,TJRJ,TJMG,TJRS,TJPR,TJSC,TJBA,TJGO,TJDFT,TJPE,TJCE,TJES,TJMT,TJMS,TJPA,TJMA,TJPB,
//   TJRN,TJAL,TJSE,TJPI,TJAM,TJRO,TJAC,TJAP,TJRR,TJTO,TRT1,TRT2,TRT15 ... (DJEN é nacional).
const TRIBUNAIS = (process.env.RADAR_TRIBUNAIS || 'TJSP,TRT15').split(',').map(s => s.trim()).filter(Boolean);
const TERMOS = ['edital de leilão', 'hasta pública', 'leilão judicial'];
// O WAF do DJEN devolve 403 p/ UA de bot vindo de datacenter (Vercel). O frontend público
// comunica.pje.jus.br consome ESTA MESMA API — então imitamos o navegador dele (UA real +
// Origin/Referer do frontend oficial + Accept-Language) p/ passar pela proteção sem custo.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DJEN_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://comunica.pje.jus.br/',
  'Origin': 'https://comunica.pje.jus.br',
};
const MAX_PAGINAS = 8;           // teto por (tribunal×termo): 8×100 = 800 itens
const HARD_MS = 270000;          // deixa folga no maxDuration 300s

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function ymd(d) { return d.toISOString().slice(0, 10); }
function parseBRL(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}
function parseDataBR(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const ano = yy.length === 2 ? '20' + yy : yy;
  const iso = `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T12:00:00Z');
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Extrai o que der do texto do edital (regex conservador; o texto integral fica guardado
// p/ refinar/plugar IA depois). Falha de parse NÃO descarta o edital (status='erro_parse').
function parseEdital(texto) {
  const t = String(texto || '');
  const pega = (re) => { const m = t.match(re); return m ? (m[1] || '').replace(/\s+/g, ' ').trim() : null; };
  const leiloeiro = pega(/leiloeir[ao]\s*(?:oficial|p[uú]blic[ao])?\s*[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ.\s]{4,60}?)(?:,|\.|\s+JUCESP|\s+inscrit|\s+matr[íi]cula|\n)/i);
  const jucesp = pega(/JUCESP[^\dA-Za-z]{0,6}(?:n[ºo.]?\s*)?([\d./-]{2,12})/i);
  const av = pega(/avalia[çc][ãa]o[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const lance = pega(/(?:lance|valor)\s+m[íi]nimo[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const praca1 = pega(/(?:1[ªa]?|primeir[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const praca2 = pega(/(?:2[ªa]?|segund[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const matricula = pega(/matr[íi]cula\s*(?:n[ºo.]?\s*)?([\d.\-]{3,15})/i);
  const plataforma = pega(/https?:\/\/([a-z0-9.\-]+\.(?:com|net|br)[^\s"'<>)]*)/i);
  // Info ADICIONAL do edital (o DJEN não traz a certidão da matrícula, mas o edital descreve
  // o imóvel/ônus): área, ocupação, cartório (CRI), débitos, endereço, cidade/UF.
  const area = pega(/[áa]rea\s*(?:total|constru[íi]da|privativa|do\s+terreno|de)?\s*[:\-]?\s*([\d.]+,\d{2})\s*m/i);
  const ocupacao = /desocupad|livre\s+de\s+ocupa|n[ãa]o\s+ocupad/i.test(t) ? 'desocupado' : (/ocupad/i.test(t) ? 'ocupado' : null);
  const cartorio = pega(/(\d{0,2}[ºoª°]?\s*(?:cart[óo]rio|of[íi]cio)\s+de\s+registro\s+de\s+im[óo]veis[^,.\n]{0,35})/i);
  const debitos = /d[ée]bito|IPTU|condom[íi]ni|ônus|onus|hipotec|penhora/i.test(t) ? 'edital menciona débitos/ônus (IPTU/condomínio/hipoteca/penhora) — conferir no texto' : null;
  const endereco = pega(/(?:situad[oa]|localizad[oa])\s+(?:[àa]|na|no|em)\s+([A-ZÀ-Ý0-9][^,\n]{6,90})/i);
  const cidadeUf = t.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ.'\s]{2,40})\s*[\/\-]\s*([A-Z]{2})\b/);
  const parsedAlgo = !!(leiloeiro || jucesp || av || lance || praca1);
  return {
    leiloeiro_nome: leiloeiro, leiloeiro_jucesp: jucesp,
    valor_avaliacao: parseBRL(av), lance_minimo: parseBRL(lance),
    data_praca_1: parseDataBR(praca1), data_praca_2: parseDataBR(praca2),
    imovel_matricula: matricula, leilao_plataforma_url: plataforma ? ('https://' + plataforma) : null,
    imovel_area_m2: area ? (parseFloat(area.replace(/\./g, '').replace(',', '.')) || null) : null,
    ocupacao, cartorio, debitos,
    imovel_endereco: endereco ? endereco.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    imovel_cidade: cidadeUf ? cidadeUf[1].replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    imovel_uf: cidadeUf ? cidadeUf[2] : null,
    status: parsedAlgo ? 'processado' : 'erro_parse',
  };
}

// Campos do item DJEN vêm com nomes variados entre versões — pega o 1º que existir.
const g = (o, ...ks) => { for (const k of ks) { if (o && o[k] != null && o[k] !== '') return o[k]; } return null; };

async function buscarDJEN(tribunal, termo, ini, fim) {
  const out = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${DJEN_BASE}?siglaTribunal=${encodeURIComponent(tribunal)}&texto=${encodeURIComponent(termo)}`
      + `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}&itensPorPagina=100&pagina=${pagina}`;
    // 1 retry curto: o WAF do DJEN às vezes barra a 1ª tentativa (challenge) e libera a 2ª.
    let json, ultimoStatus = 0;
    for (let tent = 1; tent <= 2; tent++) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      try {
        const resp = await fetch(url, { headers: DJEN_HEADERS, signal: ctrl.signal });
        if (resp.ok) { json = await resp.json(); break; }
        ultimoStatus = resp.status;
      } finally { clearTimeout(to); }
      if (tent === 1) await new Promise(r => setTimeout(r, 1500)); // backoff antes de reintentar
    }
    if (!json) throw new Error(`HTTP ${ultimoStatus || 'sem resposta'}`);
    const items = json?.items || json?.content || json?.comunicacoes || [];
    if (!items.length) break;
    out.push(...items);
    const count = Number(json?.count ?? json?.totalElements ?? 0);
    if (count && pagina * 100 >= count) break;
  }
  return out;
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const t0 = Date.now();
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── AUTO-AJUSTE + RESILIÊNCIA (o DJEN cai com frequência) ──────────────────────────────
  // O cron roda a cada 4h, mas SÓ trabalha até obter um pull BEM-SUCEDIDO do DJEN no dia. Se o
  // DJEN estiver fora do ar, o run grava o erro e o PRÓXIMO (4h depois) TENTA de novo, até
  // conseguir; após um sucesso no dia, os runs seguintes SAEM CEDO (quase de graça) → economia
  // + garantia de captura. "Sucesso" = o DJEN respondeu sem erro (mesmo com 0 editais no dia).
  // Bypass manual com ?forcar=1.
  const forcar = /[?&]forcar=1/.test(req.url || '');
  if (!forcar) {
    try {
      const { data: ok } = await supabase.from('monitor_runs')
        .select('id').eq('fonte', 'radar-editais-djen').is('erro', null)
        .gte('ran_at', ymd(new Date()) + 'T00:00:00Z').limit(1);
      if (ok && ok.length) {
        return new Response(JSON.stringify({ ok: true, skip: 'pull do DJEN já obtido hoje' }),
          { headers: { 'Content-Type': 'application/json' } });
      }
    } catch { /* se a checagem falhar, roda normalmente */ }
  }

  // Janela deslizante de 3 dias (pega itens carregados com atraso; dedup resolve repetição).
  const hoje = new Date();
  const ini = ymd(new Date(hoje.getTime() - 3 * 86400000));
  const fim = ymd(hoje);

  // Leiloeiros que JÁ raspamos (nome normalizado) → marca leiloeiro_integrado.
  const integrados = new Set();
  try {
    const { data } = await supabase.from('imoveis_leilao').select('leiloeiro').eq('ativo', true).not('leiloeiro', 'is', null).limit(5000);
    for (const r of data || []) { const n = norm(r.leiloeiro); if (n.length >= 4) integrados.add(n); }
  } catch { /* aditivo */ }
  const ehIntegrado = (nome) => {
    const n = norm(nome);
    if (n.length < 4) return false;
    for (const i of integrados) { if (i.includes(n) || n.includes(i)) return true; }
    return false;
  };

  let vistos = 0, novos = 0, erroGeral = null;
  try {
    for (const tribunal of TRIBUNAIS) {
      for (const termo of TERMOS) {
        if (Date.now() - t0 > HARD_MS) break;
        let items = [];
        try { items = await buscarDJEN(tribunal, termo, ini, fim); }
        catch (e) { erroGeral = `${tribunal}/${termo}: ${String(e.message).slice(0, 80)}`; continue; }
        vistos += items.length;
        if (!items.length) continue;

        // Monta linhas; dedup por djen_id (só insere as inéditas).
        const linhas = items.map((it) => {
          const djenId = String(g(it, 'id', 'numeroComunicacao', 'hash', 'idComunicacao') || '');
          const texto = String(g(it, 'texto', 'inteiroTeor', 'teor', 'conteudo') || '');
          const p = parseEdital(texto);
          const orgao = g(it, 'nomeOrgao', 'orgao', 'nomeVara');
          const nomeLeiloeiro = p.leiloeiro_nome;
          return {
            djen_id: djenId || null,
            fonte: 'djen',
            tribunal: g(it, 'siglaTribunal', 'tribunal') || tribunal,
            numero_processo: g(it, 'numeroProcesso', 'numero_processo', 'numeroprocessocommascara'),
            orgao, comarca: orgao, uf: 'SP',
            classe: g(it, 'nomeClasse', 'classe'),
            tipo_documento: g(it, 'tipoDocumento', 'tipoComunicacao', 'tipo'),
            data_disponibilizacao: (String(g(it, 'data_disponibilizacao', 'dataDisponibilizacao', 'datadisponibilizacao') || fim)).slice(0, 10),
            data_praca_1: p.data_praca_1, data_praca_2: p.data_praca_2,
            leiloeiro_nome: nomeLeiloeiro, leiloeiro_nome_norm: nomeLeiloeiro ? norm(nomeLeiloeiro) : null,
            leiloeiro_jucesp: p.leiloeiro_jucesp, leilao_plataforma_url: p.leilao_plataforma_url,
            leiloeiro_integrado: nomeLeiloeiro ? ehIntegrado(nomeLeiloeiro) : false,
            valor_avaliacao: p.valor_avaliacao, lance_minimo: p.lance_minimo,
            imovel_matricula: p.imovel_matricula, imovel_area_m2: p.imovel_area_m2,
            imovel_cidade: p.imovel_cidade, imovel_uf: p.imovel_uf || 'SP', imovel_endereco: p.imovel_endereco,
            debitos: p.debitos, ocupacao: p.ocupacao, cartorio: p.cartorio,
            texto_integral: texto.slice(0, 20000),
            hash_dedup: djenId ? null : norm(`${tribunal}|${g(it, 'numeroProcesso') || ''}|${texto.slice(0, 200)}`),
            payload: it,
            status: p.status,
          };
        }).filter((r) => r.djen_id || r.hash_dedup);

        // Só as inéditas (evita reprocessar): confere djen_id já existentes.
        const ids = linhas.map((r) => r.djen_id).filter(Boolean);
        const existentes = new Set();
        for (let i = 0; i < ids.length; i += 200) {
          try {
            const { data } = await supabase.from('editais_leilao').select('djen_id').in('djen_id', ids.slice(i, i + 200));
            for (const r of data || []) existentes.add(r.djen_id);
          } catch { /* aditivo */ }
        }
        const inserir = linhas.filter((r) => !r.djen_id || !existentes.has(r.djen_id));
        if (inserir.length) {
          const { error } = await supabase.from('editais_leilao').upsert(inserir, { onConflict: 'djen_id', ignoreDuplicates: true });
          if (!error) novos += inserir.length;
          else erroGeral = `upsert: ${String(error.message).slice(0, 80)}`;
        }
      }
    }
  } catch (e) {
    erroGeral = String(e.message).slice(0, 120);
  }

  // INGESTÃO: usa os editais p/ preencher avaliação faltante do acervo (chave forte: lance ==
  // valor mínimo do lote). Conservador; nunca sobrescreve avaliação existente. Aditivo.
  let enriquecidos = 0;
  try { const { data } = await supabase.rpc('editais_enriquecer_acervo'); enriquecidos = Number(data) || 0; } catch { /* aditivo */ }

  try {
    await supabase.from('monitor_runs').insert({
      fonte: 'radar-editais-djen', janela_inicio: ini, janela_fim: fim,
      itens_vistos: vistos, itens_novos: novos, duracao_ms: Date.now() - t0, erro: erroGeral,
    });
  } catch { /* nunca quebra por causa do log */ }

  return new Response(JSON.stringify({ ok: true, vistos, novos, enriquecidos, erro: erroGeral, janela: [ini, fim], tribunais: TRIBUNAIS }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
