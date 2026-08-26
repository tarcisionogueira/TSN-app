// Re-enfileira imóveis com geocoding IMPRECISO (bairro/cidade) ou que FALHARAM,
// marcando-os como 'refazer' para o cron de geocodificação tentar de novo com a
// cascata melhorada (retry/backoff + Google). Rotaciona pelo guard de 14 dias
// (geocod_reproc_em) para não re-tentar sempre os mesmos.
//
// PRIORIZA POR DESCONTO (maior primeiro): os imóveis mais atrativos são os que
// aparecem no topo da busca e no e-mail das 8h — logo, os que o usuário vê no
// mapa antes de abrir a página. Corrigi-los primeiro elimina o efeito "pino no
// bairro errado na 1ª vista" justamente onde ele mais aparece.
//
// VAZÃO: o cron /api/geocodificar (a cada 10 min) tem capacidade de ~23k/dia, mas
// só processa quem está marcado 'refazer'. Este job é o gargalo — por isso o
// limite subiu de 500 p/ 2000. Ajuste REGEOCOD_LIMITE (env) e/ou a frequência do
// cron conforme a COTA do Google Geocoding (cada reprocessamento de endereço é 1
// chamada Google; itens sem endereço reaproveitam cache por bairro no geocodificar).
export const config = { runtime: 'nodejs', maxDuration: 60 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.REGEOCOD_LIMITE || '2000', 10);
// Endereço que não virou 'rua' em três tentativas não vai virar na décima.
const MAX_TENTATIVAS = parseInt(process.env.REGEOCOD_MAX_TENTATIVAS || '3', 10);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(20000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

import { isCronAuthorized } from './_auth.js';

export default async function handler(req, resp) {
  // Auth de cron em tempo CONSTANTE (helper compartilhado isCronAuthorized).
  if (!isCronAuthorized(req)) return resp.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return resp.status(500).json({ error: 'Supabase env vars ausentes' });

  const corte = new Date(Date.now() - 14 * 86400000).toISOString();
  // Só os PIORES (cidade/falhou), NÃO 'bairro'. Desde que o cron de geocode passou a
  // rodar 100% GRÁTIS (Google reservado ao on-demand da página do imóvel), o reprocesso
  // em lote usa só Nominatim/IBGE/BrasilAPI — que raramente sobe 'bairro' → 'rua/endereço'
  // (isso é trabalho do Google, agora on-demand). Re-tentar 'bairro' (já um pino OK) só
  // martelava o Nominatim grátis à toa. Focar em cidade/falhou (onde o CEP grátis AINDA
  // melhora) reduz a carga sem perder ganho. Ordena por DESCONTO desc (imóveis mais vistos
  // primeiro); o guard de 14 dias (geocod_reproc_em) evita re-martelar os mesmos.
  // TETO DE TENTATIVAS (26/08). O guard de 14 dias evitava re-martelar os mesmos NA MESMA
  // SEMANA, mas não tinha fim: quem não melhorava voltava para a fila 14 dias depois, e de
  // novo, para sempre. Medido: dos que já foram reprocessados, 4.454 continuam imprecisos
  // contra 3.948 que melhoraram — a re-tentativa acerta 47%, e os outros 53% são endereços
  // ruins na ORIGEM, que não melhoram por insistência. Re-perguntá-los a cada 14 dias
  // custava ~9.500 chamadas por mês (a cota gratuita inteira do Google) para não mudar nada.
  // Três tentativas e o imóvel sai da fila.
  const sel = `imoveis_leilao?select=id&ativo=eq.true`
    + `&geocod_nivel=in.(cidade,falhou)`
    + `&geocod_tentativas=lt.${MAX_TENTATIVAS}`
    + `&or=(geocod_reproc_em.is.null,geocod_reproc_em.lt.${corte})`
    + `&order=desconto_percentual.desc.nullslast&limit=${LIMITE}`;
  const r = await sb(sel);
  if (!r.ok) return resp.status(500).json({ error: 'select falhou', detalhe: (await r.text()).slice(0, 200) });
  const linhas = await r.json();
  if (!linhas.length) return resp.status(200).json({ reenfileirados: 0, msg: 'nada a reprocessar' });

  const ids = linhas.map(x => x.id);
  const agora = new Date().toISOString();
  // Marca como 'refazer' (entra na fila do cron geocodificar) e carimba o reproc.
  // PATCH em blocos de 100 ids: uma URL com 500 UUIDs em id=in.(...) estoura o
  // limite de tamanho de URL do PostgREST/proxy.
  let ok = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const bloco = ids.slice(i, i + 100);
    const up = await sb(`imoveis_leilao?id=in.(${bloco.join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      // `geocod_tentativas` é incrementado no banco pela RPC, não aqui: um PATCH do
      // PostgREST não sabe somar, e mandar o valor lido de volta perderia incrementos
      // se duas execuções se cruzassem.
      body: JSON.stringify({ geocod_nivel: 'refazer', geocod_reproc_em: agora }),
    });
    if (up.ok) {
      ok += bloco.length;
      // O incremento é uma chamada à parte porque precisa ser `tentativas + 1` no servidor.
      // Falha aqui NÃO derruba o reprocessamento (o imóvel já entrou na fila), mas vai para
      // o log: contador que para de subir devolve o loop infinito em silêncio.
      const inc = await sb('rpc/geocode_contar_tentativa', {
        method: 'POST',
        body: JSON.stringify({ p_ids: bloco }),
      });
      if (!inc.ok) console.error('[regeocod] tentativa NAO contada', inc.status, (await inc.text()).slice(0, 200));
    }
  }
  return resp.status(200).json({ reenfileirados: ok, selecionados: ids.length });
}
