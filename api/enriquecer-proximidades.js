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
// LOTE 40 -> 12 e ORÇAMENTO DE TEMPO (10/08, correção da correção). Com 40 itens e o custo por
// item tendo subido (timeout maior + rodada extra), o cron passou a estourar os 300s em 7 de 16
// execuções — 44%. É exatamente o defeito que este mesmo dia apontou em três outros crons:
// **um lote é teto de CONTAGEM, nunca de TEMPO**. Agora há os dois, e o de tempo é que manda.
// 12 também reduz a pressão sobre as instâncias PÚBLICAS do Overpass, que é a causa de fundo
// dos vazios falsos (ver o cabeçalho de _proximidades.js).
const LOTE = Number(process.env.PROXIMIDADES_LOTE || 12);
const ORCAMENTO_MS = 240000; // de 300s: sobra para gravar o último item e responder
// Quantas execuções DISTINTAS precisam observar vazio antes de aceitá-lo como verdade.
// 3 observações em horários diferentes: um vazio de sobrecarga não sobrevive a isso; um vazio
// real (gleba rural, 4 km sem nada mapeado no OSM) se repete sempre.
const PROX_VAZIOS_P_ACEITAR = 3;

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
  const fila = await (await sb(`imoveis_leilao?select=id,latitude,longitude,proximidades_tentativas,proximidades_vazios&proximidades_em=is.null&proximidades_tentativas=lt.${MAX_TENT}&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=proximidades_tentativas.asc,atualizado_em.desc&limit=${LOTE}`)).json();

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
    const revalidar = await (await sb(`imoveis_leilao?select=id,latitude,longitude,proximidades_tentativas,proximidades_vazios,pontos_proximos&pontos_proximos=eq.${encodeURIComponent('{}')}&proximidades_em=lt.${encodeURIComponent(corte)}&proximidades_tentativas=lt.${MAX_TENT}&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=proximidades_em.asc&limit=${sobra}`)).json();
    if (Array.isArray(revalidar)) {
      for (const im of revalidar) {
        const p = im.pontos_proximos;
        if (p && typeof p === 'object' && Object.keys(p).length === 0) fila.push(im);
      }
    }
  }
  const T0 = Date.now();
  let ok = 0, falhas = 0, vaziosParciais = 0, cortadoPorTempo = false, i = 0;
  for (const im of (Array.isArray(fila) ? fila : [])) {
    if (Date.now() - T0 > ORCAMENTO_MS) { cortadoPorTempo = true; break; }
    try {
      // `rodizio` faz cada imóvel começar por um espelho diferente: espalha a carga em vez de
      // concentrar tudo no primeiro da lista, que é o que os limitava.
      const { pontos, vazio } = await consultarProximidades(Number(im.latitude), Number(im.longitude), { rodizio: i++ });

      if (vazio) {
        // VAZIO É INDÍCIO, NÃO VEREDITO. Um espelho saudável respondeu "não há nada" — mas foi
        // UMA observação, no instante em que os espelhos podiam estar sob carga. Conta e devolve
        // à fila; só ao repetir em execuções diferentes vira `{}` gravado.
        const n = (Number(im.proximidades_vazios) || 0) + 1;
        if (n >= PROX_VAZIOS_P_ACEITAR) {
          await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ pontos_proximos: {}, proximidades_em: new Date().toISOString(), proximidades_tentativas: 0, proximidades_vazios: n }) });
          ok++;
        } else {
          await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ proximidades_vazios: n }) });
          vaziosParciais++;
        }
        continue;
      }

      // Achou pontos: grava e sai da fila. Zera os DOIS contadores — o histórico de falhas e o
      // de vazios não dizem mais nada sobre um imóvel que agora tem resposta boa.
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString(), proximidades_tentativas: 0, proximidades_vazios: 0 }) });
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
  // `cortado_por_tempo` e `vazios_parciais` são o que distingue um ciclo saudável de um ciclo
  // que morreu no meio — antes, os dois davam a mesma resposta.
  return res.status(200).json({ ok, falhas, vazios_parciais: vaziosParciais, lote: LOTE, cortado_por_tempo: cortadoPorTempo, ms: Date.now() - T0 });
}
