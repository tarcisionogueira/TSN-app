/**
 * GET /api/enriquecer-proximidades  (cron)
 * Para imóveis já geocodificados que ainda não têm `pontos_proximos`, consulta o
 * OpenStreetMap (Overpass, grátis) e guarda o ponto MAIS PRÓXIMO de cada categoria
 * (praia, transporte, mercado, farmácia, saúde, escola, shopping) com a distância.
 * Processa em lotes pequenos (Overpass é lento/rate-limited).
 */
// Runtime NODE: as consultas ao Overpass são LENTAS e o lote estourava o limite de
// 25s de RESPOSTA INICIAL do edge → "did not return an initial response within 25s"
// (504 a cada ciclo). No Node a função tem os 300s inteiros para o lote.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { consultarProximidades } from './_proximidades.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Com os espelhos do Overpass agora em PARALELO (_proximidades.js), cada imóvel resolve em ~3-5s
// (antes até ~45s em sequência) → dá p/ processar um lote MAIOR dentro dos 300s e pré-carregar
// muito mais (menos "não carregou" na hora que o usuário abre). Ajustável por env.
const LOTE = Number(process.env.PROXIMIDADES_LOTE || 40);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    // Timeout p/ não travar o cron numa conexão pendurada ao Supabase (Overpass já
    // tem AbortSignal.timeout em _proximidades.js).
    signal: opts.signal || AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).send('Unauthorized');

  // Fila: sem pontos ainda E com menos de MAX_TENT falhas (não exclui para sempre por
  // uma falha transitória do Overpass — ver migration proximidades_tentativas_retry).
  const MAX_TENT = 5;
  const fila = await (await sb(`imoveis_leilao?select=id,latitude,longitude,proximidades_tentativas&proximidades_em=is.null&proximidades_tentativas=lt.${MAX_TENT}&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=proximidades_tentativas.asc,atualizado_em.desc&limit=${LOTE}`)).json();

  // REVALIDAÇÃO DO VAZIO (10/08). Um resultado vazio é o que uma consulta que falhou em
  // silêncio também produz — e, uma vez gravado, ficava valendo PARA SEMPRE, porque a fila
  // acima só pega `proximidades_em is null`. Foi assim que 15.764 imóveis ativos (51% do
  // acervo, incluindo 82% dos de São Paulo capital) congelaram em "Nenhum ponto de interesse
  // mapeado nas proximidades". O `{}` agora tem VALIDADE: passados 30 dias ele volta para a
  // fila e é reconferido. Um vazio verdadeiro (gleba rural) só se confirma de novo, barato;
  // um vazio falso se conserta sozinho, sem ninguém precisar perceber.
  const VALIDADE_VAZIO_D = 30;
  const corte = new Date(Date.now() - VALIDADE_VAZIO_D * 86400000).toISOString();
  const sobra = LOTE - (Array.isArray(fila) ? fila.length : 0);
  if (sobra > 0) {
    // O filtro de igualdade jsonb vai no servidor por eficiência, mas NÃO é a garantia: o
    // `select` traz `pontos_proximos` e a emptiness é reconferida aqui. Se o PostgREST
    // interpretar o literal `{}` de outro jeito, o pior caso é a busca não filtrar —
    // nunca revalidar um imóvel que já tem pontos bons e sobrescrevê-lo à toa.
    // `proximidades_tentativas` limita também aqui: senão um imóvel cuja revalidação falha
    // segue com `proximidades_em` antigo e voltaria à fila em todo run, para sempre.
    const revalidar = await (await sb(`imoveis_leilao?select=id,latitude,longitude,proximidades_tentativas,pontos_proximos&pontos_proximos=eq.${encodeURIComponent('{}')}&proximidades_em=lt.${encodeURIComponent(corte)}&proximidades_tentativas=lt.${MAX_TENT}&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=proximidades_em.asc&limit=${sobra}`)).json();
    if (Array.isArray(revalidar)) {
      for (const im of revalidar) {
        const p = im.pontos_proximos;
        if (p && typeof p === 'object' && Object.keys(p).length === 0) fila.push(im);
      }
    }
  }
  let ok = 0, falhas = 0;
  for (const im of (Array.isArray(fila) ? fila : [])) {
    try {
      const pontos = await consultarProximidades(Number(im.latitude), Number(im.longitude));
      // Sucesso. Vazio {} só chega aqui CORROBORADO por um 2º espelho (_proximidades.js) —
      // vazio sem corroboração lança e cai no catch. Grava e sai da fila via proximidades_em;
      // se for vazio, com validade de 30 dias (ver REVALIDAÇÃO DO VAZIO acima).
      // Zera as tentativas: quem foi revalidado não deve carregar o histórico de falhas antigo.
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString(), proximidades_tentativas: 0 }) });
      ok++;
    } catch (_) {
      // FALHA real (Overpass fora/limite, ou 200 com `remark`, ou vazio inconclusivo): NÃO
      // marca proximidades_em — só incrementa o contador, para ser re-tentado no próximo ciclo
      // até MAX_TENT. Sem isto, uma falha transitória excluía o imóvel da fila para sempre.
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ proximidades_tentativas: (Number(im.proximidades_tentativas) || 0) + 1 }) }).catch(() => {});
      falhas++;
    }
  }
  return res.status(200).json({ ok, falhas, lote: LOTE });
}
