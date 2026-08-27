/**
 * /api/divulgacao-cron — DIVULGAÇÃO SEGMENTADA de curso/eBook: anúncio do que é novo +
 * resgate quinzenal do que a pessoa nunca abriu.
 *
 * REGRA DO DONO (11/08), na palavra dele: "quinzenal até zerar os materiais que já foram
 * divulgados para não ficar repetindo também".
 *
 * AJUSTE DO DONO (27/08): "ao cadastrar um produto avisar e produtos que o usuário ainda não
 * visualizou ele receber 1x a divulgação daquele produto. divulgações não se repetem.
 * produtos novos devem ser divulgados."
 *
 * Passaram a existir DOIS caminhos, porque nunca deveriam ter dividido o mesmo freio:
 *   NOVIDADE — material cadastrado há pouco (DIAS_NOVIDADE) FURA a quinzena e sai como
 *              anúncio ("Novo curso na BidPro"). O UNIQUE segue garantindo 1x por pessoa.
 *   RESGATE  — material antigo que a pessoa nunca abriu MANTÉM a quinzena, e sai como
 *              lembrete. É dele que o freio anti-spam sempre foi.
 * Quem separa os dois é `divulgacao_candidatos` (coluna `novidade`), não dedução aqui.
 *
 * Não é newsletter — é uma FILA PESSOAL QUE ESVAZIA. Cada cliente recebe UM material que
 * ainda não abriu, no máximo a cada 14 dias. Quando o catálogo dele acaba, ele para de
 * receber e ninguém precisa lembrar de tirá-lo de lista nenhuma. Quem já abriu o curso
 * (tem progresso) ou comprou o produto nunca recebe aquele item.
 *
 * DIFERENÇA PARA /api/anunciar-produto: aquele é o disparo MANUAL do admin, para toda a
 * base, quando um material sai ("olha o que acabou de chegar"). Este é o resgate contínuo
 * de quem não viu. Os dois compartilham o mesmo template (api/_produto-email.js) de
 * propósito — duas cópias do HTML divergiriam na primeira melhoria feita em uma só.
 *
 * PROTEÇÕES, todas herdadas de erros já pagos nesta base:
 *   • Nunca equipe/admin — a RPC filtra por role de cliente (o cron de retenção já nudou o
 *     próprio admin uma vez; não se repete).
 *   • Opt-out respeitado (alertas_email.ativo=false), com link de descadastro no rodapé.
 *   • CLAIM ANTES DE ENVIAR: a linha em `divulgacao_envio` é inserida primeiro, com UNIQUE
 *     em (user_id, tipo, produto_id). Se o cron rodar duas vezes, a segunda colide e não
 *     manda de novo. `email_ok` é atualizado depois com o desfecho real.
 *   • Interruptor no banco: app_config.divulgacao_ativa = 'false' desliga sem deploy.
 *
 * Agendado DIARIAMENTE desde 27/08 (era semanal). Não é aumento de volume: quem impõe o
 * ritmo continua sendo a RPC — a quinzena por PESSOA no resgate e o UNIQUE em tudo. O que
 * muda é a LATÊNCIA: com o cron semanal, um material cadastrado na quinta só seria anunciado
 * na quarta seguinte, e "avisar ao cadastrar" viraria "avisar em até 6 dias".
 *
 * ⚠️ O QUE IMPEDE RAJADA: a RPC devolve NO MÁXIMO UM material por pessoa por execução
 * (`distinct on`). Cadastrar cinco produtos de uma vez manda um e-mail, não cinco.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { corpoEmailProduto, emailsDoLote } from './_produto-email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const INTERVALO_DIAS = Number(process.env.DIVULGACAO_INTERVALO_DIAS || 14);
// Por quantos dias um material recem-cadastrado conta como NOVIDADE — e, sendo novidade,
// fura a quinzena (regra do dono, 27/08: "produtos novos devem ser divulgados").
const DIAS_NOVIDADE = Number(process.env.DIVULGACAO_DIAS_NOVIDADE || 14);
const TETO = Number(process.env.DIVULGACAO_TETO || 500); // teto por execução (base pequena)
const CONC = 5;                                          // ritmo tranquilo no Resend

const hdr = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const seco = new URL(req.url, `https://${req.headers.host}`).searchParams.get('seco') === '1';

  // Interruptor: `false` explícito desliga. Ausente = ligado (o padrão é funcionar).
  try {
    const r = await sb('app_config?key=eq.divulgacao_ativa&select=value');
    if (r.ok) {
      const [linha] = await r.json();
      if (linha && String(linha.value).replace(/"/g, '') === 'false') {
        res.status(200).json({ ok: true, enviados: 0, motivo: 'desligado em app_config.divulgacao_ativa' });
        return;
      }
    }
  } catch { /* sem config = ligado */ }

  // Candidatos: no máximo 1 material por pessoa, já filtrado por opt-out, role e quinzena.
  const rCand = await sb('rpc/divulgacao_candidatos', {
    method: 'POST',
    body: JSON.stringify({ p_limite: TETO, p_intervalo_dias: INTERVALO_DIAS, p_dias_novidade: DIAS_NOVIDADE }),
  });
  // `.ok` checado: falha de leitura NÃO é "ninguém para divulgar". Sem isto, uma RPC quebrada
  // devolveria `enviados: 0` com cara de dia tranquilo, e a divulgação morreria em silêncio.
  if (!rCand.ok) {
    const txt = (await rCand.text().catch(() => '')).slice(0, 200);
    console.error('[divulgacao] candidatos falhou', rCand.status, txt);
    res.status(502).json({ ok: false, erro: `candidatos HTTP ${rCand.status}`, detalhe: txt });
    return;
  }
  const cands = await rCand.json().catch(() => null);
  if (!Array.isArray(cands)) {
    res.status(502).json({ ok: false, erro: 'candidatos com corpo inesperado' });
    return;
  }
  if (!cands.length) {
    console.log('[divulgacao]', JSON.stringify({ candidatos: 0, motivo: 'catálogo esgotado ou dentro da quinzena' }));
    res.status(200).json({ ok: true, candidatos: 0, enviados: 0, motivo: 'catálogo esgotado ou todos dentro da quinzena' });
    return;
  }

  if (seco) {
    // Prévia sem enviar nem gravar — para o dono conferir quem receberia o quê.
    const porProduto = {};
    for (const c of cands) { const k = `${c.tipo}:${c.titulo}${c.novidade ? ' (novidade)' : ''}`; porProduto[k] = (porProduto[k] || 0) + 1; }
    res.status(200).json({ ok: true, seco: true, candidatos: cands.length,
      novidades: cands.filter((c) => c.novidade === true).length, por_produto: porProduto });
    return;
  }

  const emailMap = await emailsDoLote(cands.map((c) => c.user_id));
  const comEmail = cands.filter((c) => emailMap.has(c.user_id));
  const semEmail = cands.length - comEmail.length;

  let enviados = 0, falhas = 0, jaClamados = 0, novidades = 0;
  for (let i = 0; i < comEmail.length; i += CONC) {
    const bloco = comEmail.slice(i, i + CONC);
    const res1 = await Promise.all(bloco.map(async (c) => {
      // CLAIM primeiro. O UNIQUE (user_id, tipo, produto_id) é o que impede envio duplo se
      // o cron rodar duas vezes ou se uma execução anterior tiver morrido no meio.
      const rIns = await sb('divulgacao_envio', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: c.user_id, tipo: c.tipo, produto_id: c.produto_id }),
      });
      if (rIns.status === 409) return 'ja_clamado';   // outra execução pegou este par
      if (!rIns.ok) return 'falha';
      const [linha] = await rIns.json().catch(() => []);

      const produto = { id: c.produto_id, titulo: c.titulo, descricao: c.descricao, capa_url: c.capa_url, preco: c.preco, cor: c.cor };
      // O CONTEXTO SEGUE O SINAL DA RPC, e isso não é detalhe de texto: dizer "você ainda não
      // viu" sobre um material que ACABOU DE SAIR soa a cobrança por algo que nunca esteve lá,
      // e queima a novidade que era o motivo do e-mail. `novidade` vem de `criado_em`, não de
      // dedução aqui — quem decide o que é lançamento é a mesma consulta que decide quem recebe.
      const ehNovidade = c.novidade === true;
      const html = corpoEmailProduto({
        tipo: c.tipo, produto, nome: c.nome,
        contexto: ehNovidade ? 'novidade' : 'lembrete',
        userId: c.user_id, tipoEmail: 'divulgacao_produto',
      }).replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(c.user_id)}`);
      const rotulo = c.tipo === 'curso' ? 'curso' : 'eBook';
      const assunto = (ehNovidade
        ? `Novo ${rotulo} na BidPro: ${c.titulo || ''}`
        : `Você ainda não viu este ${rotulo}: ${c.titulo || ''}`).trim().slice(0, 120);

      const env = await enviarEmail({
        from: FROM, to: emailMap.get(c.user_id), subject: assunto, html,
        meta: { tipo: 'divulgacao_produto', userId: c.user_id },
      });
      // Grava o desfecho REAL no log. Sem isto, "divulgado" significaria apenas "tentei".
      if (linha?.id) {
        await sb(`divulgacao_envio?id=eq.${linha.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ email_ok: !!env?.ok }),
        }).catch(() => {});
      }
      if (env?.ok && ehNovidade) novidades++;
      return env?.ok ? 'ok' : 'falha';
    }));
    for (const r of res1) {
      if (r === 'ok') enviados++;
      else if (r === 'ja_clamado') jaClamados++;
      else falhas++;
    }
  }

  const saida = { candidatos: cands.length, enviados, novidades, resgates: enviados - novidades,
                  falhas, sem_email: semEmail, ja_clamados: jaClamados,
                  intervalo_dias: INTERVALO_DIAS, dias_novidade: DIAS_NOVIDADE };
  console.log('[divulgacao]', JSON.stringify(saida));
  res.status(200).json({ ok: true, ...saida });
}
