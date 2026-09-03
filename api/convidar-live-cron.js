/**
 * GET /api/convidar-live-cron — o convite da base disparado por AGENDA, sem ninguém acordado.
 *
 * POR QUE NÃO É UM CRON QUE SIMPLESMENTE MANDA TODA SEMANA: a aula é semanal, e um convite
 * automático toda semana significaria, para quem nunca se inscreve, quatro e-mails de
 * marketing por mês. O disparo precisa ser um ATO, não um hábito da máquina.
 *
 * Daí o ARMAMENTO: este cron só envia quando `app_config.convite_live_armado` contém
 * EXATAMENTE a data da próxima edição (ex.: `2026-09-09`). Fora isso ele acorda, confere e
 * volta a dormir sem gastar nada.
 *
 * ⚠️ ELE NÃO DESARMA MAIS DEPOIS DO PRIMEIRO ENVIO (03/09), e essa era a falha.
 * O armamento vale para a EDIÇÃO INTEIRA, não para uma rodada. Enquanto ele desarmava no fim
 * do primeiro disparo, o cron — que é DIÁRIO — respondia `ok:true, motivo:'não armado'` em
 * todos os dias seguintes. Medido: os 74 convites da edição de 02/09 saíram numa janela de
 * 14 SEGUNDOS em 30/08 11:00, e as 21 pessoas que se cadastraram entre aquele instante e a
 * aula NUNCA receberam convite. Não é um caso de borda: quem chega na semana da aula é
 * justamente quem o anúncio acabou de trazer, o lead mais quente da base.
 *
 * O QUE IMPEDE O REENVIO, ENTÃO: o UNIQUE (evento_id, user_id, edicao) de
 * `live_convite_envio`, com claim ANTES do e-mail. É a trava certa para isso — ela é por
 * PESSOA, e o desarme era por RODADA. Repetir a rodada agora é barato e desejado: ela só
 * alcança quem entrou desde ontem.
 *
 * E O DESARME AINDA EXISTE, só que no lugar certo: quando a edição armada FICA PARA TRÁS
 * (`live_proxima` já aponta para a semana seguinte), o cron limpa a chave sozinho. Assim a
 * autorização do dono nunca vaza de uma edição para a outra.
 *
 * DUAS TRAVAS, de propósito, porque elas protegem coisas diferentes: o armamento decide SE a
 * edição foi autorizada; o UNIQUE de `live_convite_envio` decide se a PESSOA já foi convidada.
 * Sem o armamento, o cron mandaria toda semana; sem o UNIQUE, uma execução que morresse no
 * meio reenviaria para quem já recebeu.
 *
 * COMO ARMAR (é o que o dono autoriza, uma edição por vez):
 *   insert into app_config (key, value) values ('convite_live_armado', '2026-09-09')
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
      // A EDIÇÃO ARMADA FICOU PARA TRÁS → limpa. É aqui que o desarme passou a viver: a
      // autorização do dono morre com a edição dela, não com a primeira rodada. Comparação
      // de texto funciona porque as duas são `YYYY-MM-DD`, onde ordem alfabética é ordem
      // cronológica. Armado para o FUTURO não limpa: é o dono adiantando a próxima.
      if (armado < ed.edicao) {
        const desarmou = await gravarConfig('convite_live_armado', '');
        if (!desarmou) console.error('[convidar-live-cron] NÃO desarmou a edição vencida', armado);
        res.status(200).json({ ok: true, enviados: 0, desarmou, motivo: `edição ${armado} passou — desarmado` });
        return;
      }
      res.status(200).json({ ok: true, enviados: 0, motivo: `armado para ${armado}, próxima edição é ${ed.edicao}` });
      return;
    }

    // SEGUE ARMADO depois de enviar — ver o cabeçalho. O UNIQUE por pessoa/edição é o que
    // impede o duplo; rodar de novo amanhã é como quem se cadastrou hoje recebe o convite.
    const saida = await dispararConvite({ ...ed, slug: SLUG });

    console.log('[convidar-live-cron]', JSON.stringify({ ...saida, segue_armado: ed.edicao }));
    res.status(200).json({ ok: true, segue_armado: ed.edicao, ...saida });
  } catch (e) {
    // Falha de leitura não pode virar "convidei zero pessoas com sucesso" — 502 para o alerta
    // de cron enxergar.
    console.error('[convidar-live-cron]', e?.message || e);
    res.status(502).json({ ok: false, erro: String(e?.message || e) });
  }
}
