/**
 * /api/desativar-encerrados-cron — de hora em hora, tira de circulação o lote cujo leilão venceu.
 *
 * POR QUE DE HORA EM HORA, se o gatilho do banco já derruba a cada escrita do scraper: o gatilho
 * só age quando ALGUÉM escreve na linha. Um lote que ninguém tocou e cujo prazo venceu sozinho
 * ficaria visível até o próximo scrape da fonte. Regra do dono (07/08): lote com data passada não
 * pode ficar aparecendo e criando expectativa — e "até amanhã de manhã" não é aparecer pouco.
 *
 * A decisão de quem vence está em `public.leilao_ja_encerrado` (uma regra só, no banco), com as
 * mesmas cautelas do gate de relatório: venda direta nunca vence por data, e vale a MAIS FUTURA
 * das datas conhecidas (só a 1ª praça ter passado é normal).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 }; // 60 s: cabe 1 nova tentativa no timeout (13/10)

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // 13/10: falha deste passo NÃO aborta mais os outros. Medido: estourava o statement timeout de
  // 8 s em 1 de cada 2 horas, e cada falha pulava o desconto anunciado e os números da vitrine.
  // 13/10 (noite): a função custa ~0,1 s parada e 28 ms por imóvel desligado (medido com EXPLAIN
  // ANALYZE), mas no pg_stat_statements vai de 35 ms a 8 s: estoura só quando pega o banco carregado
  // pela onda das :00 (44 dos 76 crons). Cron movido para :37 e UMA nova tentativa no timeout — segura,
  // porque cada chamada desliga no máximo 500 e o que já saiu não volta para a fila.
  // 18/10 (pendência 222): a função passou a desligar no máx. 150 por chamada (500 × 28 ms = 14 s estourava os
  // 8 s mesmo sem carga). Lote cheio = pode haver mais: chama de novo enquanto couber no orçamento de 35 s.
  // 19/10: orçamento de TEMPO contra o maxDuration (60 s). Antes: laço até 35 s + 15 s de espera + 2 × 8 s de
  // timeout + 3 RPCs finais podia passar de 60 s — a Vercel mata a função, e o log/resposta (que é o que
  // distingue "nada a fazer" de "parou") nunca saía. Agora: nova tentativa só se couber com folga para as
  // finais, e cada RPC final roda com AbortSignal pelo tempo que resta (ou é pulada, dizendo que foi).
  const LOTE = 150, inicio = Date.now();
  const LIMITE_MS = 56000;      // maxDuration 60 s − folga para log e resposta
  const CUSTO_RPC_MS = 9000;    // statement timeout de 8 s + rede
  const RESERVA_FINAL_MS = 12000; // as 3 RPCs finais costumam somar ~2-3 s; acima disso cada uma é cortada pelo relógio
  const restante = () => LIMITE_MS - (Date.now() - inicio);
  let desativados = null, total = 0, chamadas = 0;
  rodada: while (Date.now() - inicio < 35000 && restante() > CUSTO_RPC_MS + RESERVA_FINAL_MS && chamadas < 6) {
    chamadas++;
    let n = null;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/desativar_leiloes_encerrados`, {
          method: 'POST',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(Math.max(1000, restante() - RESERVA_FINAL_MS)),
        });
        if (r.ok) { n = Number(await r.json().catch(() => 0)) || 0; break; }
        const txt = (await r.text().catch(() => '')).slice(0, 200);
        desativados = { erro: `${r.status} ${txt}`, tentativas: tentativa, ja_desativados: total };
        if (!/57014/.test(txt)) break rodada; // só o timeout de carga vale nova tentativa
        if (tentativa === 1 && restante() < 15000 + CUSTO_RPC_MS + RESERVA_FINAL_MS) {
          desativados.erro += ' · sem tempo no maxDuration para nova tentativa';
          break rodada;
        }
        await new Promise(ok => setTimeout(ok, 15000));
      } catch (e) { desativados = { erro: String(e?.message || e).slice(0, 200), tentativas: tentativa, ja_desativados: total }; break rodada; }
    }
    if (n === null) break;
    total += n;
    desativados = total;
    if (n < LOTE) break; // veio menos que um lote: a fila acabou
  }

  // RPC final com o relógio: pulada (e dito por extenso) se não há tempo; cortada se passar do que resta.
  const rpcFinal = async (nome, comStatus = false) => {
    if (restante() < 1500) return { erro: 'pulado: sem tempo no maxDuration (a próxima rodada horária faz)' };
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(Math.max(1000, restante())),
      });
      if (r.ok) return await r.json().catch(() => null);
      const txt = (await r.text().catch(() => '')).slice(0, 200);
      return { erro: comStatus ? `${r.status} ${txt}` : txt };
    } catch (e) { return { erro: String(e?.message || e).slice(0, 200) }; }
  };

  // Cópias do mesmo bem (13/10): veículo relistado e 2ª praça publicada como outro anúncio.
  // RPC própria — dentro de desativar_leiloes_encerrados somava ~2 s a quem já estourava o teto.
  const relistados = await rpcFinal('reconciliar_relistados', true);

  // Mesma varredura horária cuida do DESCONTO ANUNCIADO: ele é o da praça mais descontada ainda
  // DISPONÍVEL, e "ainda disponível" muda com o relógio sem ninguém escrever na linha. Quando a
  // 2ª praça vence, o desconto tem de voltar a ser o da praça que sobrou — senão o card anuncia
  // um abatimento que não existe mais.
  const descontos = await rpcFinal('recalcular_desconto_praca');
  // 29/08: e os NÚMEROS DA VITRINE da aula ao vivo, pelo mesmo motivo — quem muda a conta é esta
  // varredura, ao ligar/desligar `ativo`. Eles eram calculados na hora e a página do tráfego pago
  // levava `statement timeout` (1,7 s varrendo 66 mil linhas com dois count(distinct)); agora vive
  // em `plataforma_numeros_cache`, lido em 1 ms. Se este passo parar, o invariante
  // `live_numeros_congelados` acusa em 3 h — cache que envelhece calado seria só outro defeito.
  const numeros = await rpcFinal('live_plataforma_numeros_atualizar');

  // Log sempre, inclusive o zero: é o que permite ver que a varredura RODOU num dia sem baixas
  // (silêncio total não distingue "nada a fazer" de "cron parou").
  const falhou = [desativados, relistados, descontos, numeros].some(v => v && typeof v === 'object' && v.erro);
  (falhou ? console.error : console.log)('[desativar-encerrados]', JSON.stringify({ desativados, relistados, descontos, numeros }));
  res.status(falhou ? 500 : 200).json({ ok: !falhou, desativados, relistados, descontos_recalculados: descontos, numeros_vitrine: numeros });
}
