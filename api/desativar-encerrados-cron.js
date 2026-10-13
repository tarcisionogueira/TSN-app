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
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // 13/10: falha deste passo NÃO aborta mais os outros. Medido: estourava o statement timeout de
  // 8 s em 1 de cada 2 horas, e cada falha pulava o desconto anunciado e os números da vitrine.
  let desativados = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/desativar_leiloes_encerrados`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    desativados = r.ok ? await r.json().catch(() => 0) : { erro: `${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}` };
  } catch (e) { desativados = { erro: String(e?.message || e).slice(0, 200) }; }

  // Cópias do mesmo bem (13/10): veículo relistado e 2ª praça publicada como outro anúncio.
  // RPC própria — dentro de desativar_leiloes_encerrados somava ~2 s a quem já estourava o teto.
  let relistados = null;
  try {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reconciliar_relistados`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    relistados = rr.ok ? await rr.json().catch(() => null) : { erro: `${rr.status} ${(await rr.text().catch(() => '')).slice(0, 200)}` };
  } catch (e) { relistados = { erro: String(e?.message || e).slice(0, 200) }; }

  // Mesma varredura horária cuida do DESCONTO ANUNCIADO: ele é o da praça mais descontada ainda
  // DISPONÍVEL, e "ainda disponível" muda com o relógio sem ninguém escrever na linha. Quando a
  // 2ª praça vence, o desconto tem de voltar a ser o da praça que sobrou — senão o card anuncia
  // um abatimento que não existe mais.
  let descontos = null;
  try {
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recalcular_desconto_praca`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    descontos = r2.ok ? await r2.json().catch(() => null) : { erro: (await r2.text().catch(() => '')).slice(0, 200) };
  } catch (e) { descontos = { erro: String(e?.message || e).slice(0, 200) }; }
  // 29/08: e os NÚMEROS DA VITRINE da aula ao vivo, pelo mesmo motivo — quem muda a conta é esta
  // varredura, ao ligar/desligar `ativo`. Eles eram calculados na hora e a página do tráfego pago
  // levava `statement timeout` (1,7 s varrendo 66 mil linhas com dois count(distinct)); agora vive
  // em `plataforma_numeros_cache`, lido em 1 ms. Se este passo parar, o invariante
  // `live_numeros_congelados` acusa em 3 h — cache que envelhece calado seria só outro defeito.
  let numeros = null;
  try {
    const r3 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/live_plataforma_numeros_atualizar`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    numeros = r3.ok ? await r3.json().catch(() => null) : { erro: (await r3.text().catch(() => '')).slice(0, 200) };
  } catch (e) { numeros = { erro: String(e?.message || e).slice(0, 200) }; }

  // Log sempre, inclusive o zero: é o que permite ver que a varredura RODOU num dia sem baixas
  // (silêncio total não distingue "nada a fazer" de "cron parou").
  const falhou = [desativados, relistados, descontos, numeros].some(v => v && typeof v === 'object' && v.erro);
  (falhou ? console.error : console.log)('[desativar-encerrados]', JSON.stringify({ desativados, relistados, descontos, numeros }));
  res.status(falhou ? 500 : 200).json({ ok: !falhou, desativados, relistados, descontos_recalculados: descontos, numeros_vitrine: numeros });
}
