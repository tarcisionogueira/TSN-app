/**
 * GET /api/convidar-live-cron — o convite da base disparado por AGENDA, sem ninguém acordado.
 *
 * POR QUE NÃO É UM CRON QUE SIMPLESMENTE MANDA TODA SEMANA: a aula é semanal, e um convite
 * automático toda semana significaria, para quem nunca se inscreve, quatro e-mails de
 * marketing por mês. O disparo precisa ser um ATO, não um hábito da máquina.
 *
 * Daí o ARMAMENTO: este cron só envia quando `app_config.convite_live_armado` contém
 * EXATAMENTE a data da próxima edição (ex.: `2026-09-02`). Fora isso ele acorda, confere e
 * volta a dormir sem gastar nada. Depois de enviar, ele mesmo desarma — então uma execução
 * repetida, um retry da Vercel ou um domingo seguinte não reenviam.
 *
 * DUAS TRAVAS, de propósito, porque elas protegem coisas diferentes: o armamento decide SE a
 * edição foi autorizada; o UNIQUE de `live_convite_envio` decide se a PESSOA já foi convidada.
 * Sem o armamento, o cron mandaria toda semana; sem o UNIQUE, uma execução que morresse no
 * meio reenviaria para quem já recebeu.
 *
 * COMO ARMAR (é o que o dono autoriza, uma edição por vez):
 *   insert into app_config (key, value) values ('convite_live_armado', '2026-09-02')
 *     on conflict (key) do update set value = excluded.value;
 */
import { isCronAuthorized } from './_auth.js';
import { carregarEdicao, dispararConvite, lerConfig, gravarConfig } from './_convite-live.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const SLUG = process.env.CONVITE_LIVE_SLUG || 'leilao-ao-vivo';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  try {
    const armado = await lerConfig('convite_live_armado');
    if (!armado) {
      res.status(200).json({ ok: true, enviados: 0, motivo: 'não armado' });
      return;
    }

    const ed = await carregarEdicao(SLUG);
    if (!ed) { res.status(200).json({ ok: true, enviados: 0, motivo: 'aula inativa' }); return; }

    // A comparação é com a EDIÇÃO calculada por `live_proxima`, não com "hoje". Se a aula for
    // remarcada depois do armamento, o cron simplesmente não dispara — e isso é o certo:
    // convite autorizado para uma data não é convite autorizado para outra.
    if (armado !== ed.edicao) {
      res.status(200).json({ ok: true, enviados: 0, motivo: `armado para ${armado}, próxima edição é ${ed.edicao}` });
      return;
    }

    const saida = await dispararConvite({ ...ed, slug: SLUG });

    // DESARMA DEPOIS DE ENVIAR. Falhar aqui deixaria o cron armado para a mesma edição — e o
    // UNIQUE de `live_convite_envio` seguraria o reenvio, mas o log ficaria mentindo. Por isso
    // o desfecho do desarme entra na resposta em vez de ser engolido.
    const desarmou = await gravarConfig('convite_live_armado', '');
    if (!desarmou) console.error('[convidar-live-cron] NÃO desarmou — app_config seguiu com', armado);

    console.log('[convidar-live-cron]', JSON.stringify({ ...saida, desarmou }));
    res.status(200).json({ ok: true, desarmou, ...saida });
  } catch (e) {
    // Falha de leitura não pode virar "convidei zero pessoas com sucesso" — 502 para o alerta
    // de cron enxergar.
    console.error('[convidar-live-cron]', e?.message || e);
    res.status(502).json({ ok: false, erro: String(e?.message || e) });
  }
}
