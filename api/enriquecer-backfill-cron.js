/**
 * /api/enriquecer-backfill-cron — completa o banco (DATA do leilão) de imóveis sem
 * data, PRIORIZANDO as cidades de interesse dos usuários (perfis.cidades_interesse).
 * Assim o gasto de Bright Data segue a DEMANDA real, não o tamanho do acervo.
 *
 * Scraper-first e econômico: só busca quem NÃO tem data (nunca sobrescreve), lê a
 * PÁGINA do lote (reusa fetchLote/extrairDataLeilao), respeita o TETO semanal do
 * Bright Data (fetchViaBrightData corta sozinho) e para de martelar quando começa a
 * vir vazio (sinal de teto atingido). Reveza por enriquecido_em. CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { fetchLote, extrairDatasLeilao } from './enriquecer-lote.js';
import { extrairAreaM2, extrairDescricaoDoCorpo } from './_texto-imovel.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE_MAX = parseInt(process.env.ENRIQUECER_BACKFILL_LOTE || '40', 10); // 30–50/execução

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function marcar(id, patch) {
  await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // 1) Cidades de interesse dos usuários (prioridade do backfill).
  let cidadeSet = new Set();
  try {
    const rows = await (await sb('perfis?cidades_interesse=not.is.null&select=cidades_interesse&limit=1000')).json();
    for (const r of (Array.isArray(rows) ? rows : [])) {
      for (const c of (Array.isArray(r?.cidades_interesse) ? r.cidades_interesse : [])) {
        if (c?.cidade) cidadeSet.add(String(c.cidade).trim().toLowerCase());
      }
    }
  } catch { /* sem cidades → backfill geral */ }

  // 2) Pool de candidatos: sem data, não venda direta, ativo, com página de lote.
  //    Puxa um pool maior e ordena as CIDADES DOS USUÁRIOS primeiro (in-memory,
  //    evita o encoding frágil do filtro in.() com acentos/espaços).
  // Falta data = sem INÍCIO **ou** sem ENCERRAMENTO (antes só olhava data_leilao, então lote
  // com início já gravado nunca voltava aqui e o prazo real nunca era capturado).
  // ALVO AMPLIADO PARA A METRAGEM (18/08). Antes só entrava quem faltava DATA — e por isso os
  // 457 lotes sem área nem matrícula nunca eram visitados por aqui: 416 deles jamais tinham
  // sido enriquecidos. A metragem mora na MESMA página que este cron já baixa para ler a data,
  // então cobri-la não custa uma requisição a mais nos lotes que ele já visitaria, e abre
  // cobertura para os que só têm o buraco da área.
  const filtro = [
    'or=(data_leilao.is.null,data_leilao_2.is.null,area_m2.is.null,area_m2.eq.0)',
    'modalidade=not.ilike.*venda*direta*',
    'ativo=not.is.false',
    'select=id,url_lote,link_edital,cidade,fonte,data_leilao,data_leilao_2,area_m2,titulo,descricao',
    'order=enriquecido_em.asc.nullsfirst',
    `limit=${LOTE_MAX * 5}`,
  ].join('&');
  // 19/08: o corpo de ERRO do PostgREST é um objeto — `Array.isArray` falso fazia o cron
  // reportar `ok:true, sem_candidatos`, indistinguível de banco vazio. Falha de leitura
  // agora se apresenta como falha.
  const poolRes = await sb(`imoveis_leilao?${filtro}`);
  if (!poolRes.ok) { res.status(200).json({ ok: false, motivo: `leitura_falhou_http_${poolRes.status}` }); return; }
  const pool = await poolRes.json().catch(() => null);
  if (!Array.isArray(pool)) { res.status(200).json({ ok: false, motivo: 'resposta_invalida' }); return; }
  if (!pool.length) {
    res.status(200).json({ ok: true, processados: 0, com_data: 0, motivo: 'sem_candidatos' }); return;
  }
  if (cidadeSet.size) {
    pool.sort((a, b) => {
      const pa = cidadeSet.has(String(a.cidade || '').toLowerCase()) ? 0 : 1;
      const pb = cidadeSet.has(String(b.cidade || '').toLowerCase()) ? 0 : 1;
      return pa - pb; // cidades dos usuários primeiro (sort estável preserva a ordem por enriquecido_em)
    });
  }
  const lista = pool.slice(0, LOTE_MAX);

  let comData = 0, comFim = 0, semConteudo = 0, prioridade = 0, comArea = 0, comTexto = 0;
  const agora = new Date().toISOString();
  for (const im of lista) {
    if (cidadeSet.has(String(im.cidade || '').toLowerCase())) prioridade++;
    const alvo = im.url_lote || im.link_edital;
    const patch = { enriquecido_em: agora };
    if (alvo && /^https?:\/\//.test(alvo)) {
      const { html, semCota } = await fetchLote(alvo);
      // 19/08: recusa de ORÇAMENTO não é visita — carimbar `enriquecido_em` aqui jogava o
      // lote para o fim da fila sem nunca tê-lo lido (forma #5). Sem cota, para o run
      // inteiro sem carimbar ninguém: o freio vale para todos os próximos também.
      if (semCota) { semConteudo++; console.error('[backfill] sem cota Bright Data — run interrompido sem carimbar os restantes'); break; }
      if (html) {
        const { inicio, fim } = extrairDatasLeilao(html);
        if (inicio && !im.data_leilao) { patch.data_leilao = inicio; comData++; }
        if (fim && !im.data_leilao_2) { patch.data_leilao_2 = fim; comFim++; }
        // TEXTO E METRAGEM, do MESMO html que já está na mão — zero requisição extra.
        // A descrição só é substituída quando a atual é ECO DO TÍTULO (o defeito medido em
        // 17/08: fora da CEF, `descricao` era o título e nada mais em 7 fontes inteiras).
        // Nunca sobrescreve texto que já diz algo — o dia é fonte da verdade só do que traz.
        if (!(Number(im.area_m2) > 0)) {
          const corpo = extrairDescricaoDoCorpo(html);
          const ecoDoTitulo = !im.descricao || im.descricao.trim() === String(im.titulo || '').trim();
          if (corpo && ecoDoTitulo) { patch.descricao = corpo.slice(0, 2000); comTexto++; }
          const area = extrairAreaM2(corpo || '') || extrairAreaM2(html);
          if (area > 0) { patch.area_m2 = area; comArea++; }
        }
      } else {
        semConteudo++;
        // Vazio recorrente = teto do Bright Data atingido → para de martelar.
        if (semConteudo >= 5) { await marcar(im.id, patch); break; }
      }
    }
    await marcar(im.id, patch);
  }

  res.status(200).json({ ok: true, processados: lista.length, com_data: comData, com_encerramento: comFim, com_area: comArea, com_texto: comTexto, sem_conteudo: semConteudo, de_cidades_de_usuarios: prioridade });
}
