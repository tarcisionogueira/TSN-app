/**
 * CHAMADO DE DOCUMENTOS DO LEILOEIRO (04/11, pedido do dono)
 *
 * Quando o pedido de documento ao leiloeiro não consegue andar sozinho — sem e-mail cadastrado
 * (`sem_contato`), leiloeiro que não responde (`equipe_whatsapp`) ou e-mail que não saiu
 * (`falha`) —, o lote vira um CHAMADO no Atendimento, com dono, histórico e o que fazer.
 *
 *  - UM chamado aberto por lote (índice único parcial `uq_chamado_documentos_leiloeiro_aberto`):
 *    dez clientes olhando o mesmo lote não viram dez chamados; cada novo motivo vira mensagem.
 *  - `segmento='interno'`, sem `user_id`: a RLS de chamados entrega a admin e analista.
 *  - Encerrar é do banco: o gatilho `zz_anexo_chamado_documentos` (migração 20261104) fecha o
 *    chamado quando o que foi pedido entra no lote, venha por onde vier.
 *
 * Nunca lança: quem chama é a geração de relatório ou o pedido ao leiloeiro, e o chamado é
 * acessório a eles. O retorno diz o que aconteceu (`ok`/`erro`), não um null ambíguo.
 */

import { contatoNaJunta } from './_contato-junta.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

export const TIPO_CHAMADO_DOCUMENTOS = 'documentos_leiloeiro';

const MOTIVO = {
  sem_contato: {
    porque: 'não temos e-mail cadastrado para este leiloeiro, então o pedido automático não saiu.',
    fazer: 'Ligue para o telefone abaixo, ou use o e-mail da Junta Comercial no painel deste chamado ("Usar este e-mail") e clique em "Enviar e-mail pronto". O e-mail cadastrado vale para todos os lotes dele.',
  },
  equipe_whatsapp: {
    porque: 'o leiloeiro não respondeu os últimos pedidos por e-mail, então o automático parou de insistir.',
    fazer: 'Peça pelo telefone/WhatsApp do leiloeiro. O que ele mandar, anexe pelo painel deste chamado: o lote recebe o documento e as análises são geradas de novo.',
  },
  // 05/11 (dono): todo lote sem matrícula/edital vira chamado, mesmo quando o e-mail saiu.
  acompanhar: {
    porque: 'falta documento no lote e o pedido saiu por e-mail para o leiloeiro — acompanhe até chegar.',
    fazer: 'Se o leiloeiro não responder em até 2 dias úteis, ligue ou chame no WhatsApp pelos contatos abaixo. O que ele mandar, anexe pelo painel deste chamado: o chamado fecha sozinho e o cliente é avisado de que já pode gerar o relatório.',
  },
  falha: {
    porque: 'o e-mail ao leiloeiro não saiu (o provedor recusou ou deu erro).',
    fazer: 'Confira o endereço do leiloeiro no painel deste chamado e tente "Enviar pedido ao leiloeiro" de novo.',
  },
};

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function chamadoAberto(imovelId) {
  const r = await sb(`chamados?tipo=eq.${TIPO_CHAMADO_DOCUMENTOS}&imovel_id=eq.${encodeURIComponent(imovelId)}&status=neq.finalizado&select=id&limit=1`);
  if (!r.ok) throw new Error(`ler chamado HTTP ${r.status}`);
  const [c] = await r.json();
  return c?.id || null;
}

function dataLeilao(im) {
  const v = im.praca2_fim || im.praca1_fim || im.data_leilao_2 || im.data_leilao;
  if (!v) return null;
  const t = String(v);
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
}

// Telefones para LIGAR já ao abrir o chamado (05/11, dono): o cadastrado por nós primeiro, depois o
// que a Junta Comercial publica. Leitura que falhou vira linha dizendo isso, não silêncio.
async function contatosParaLigar(imovel) {
  const linhas = [];
  try {
    const r = await sb('rpc/telefone_leiloeiro_resolver', { method: 'POST', body: JSON.stringify({ p_fonte: imovel?.fonte || '', p_leiloeiro: imovel?.leiloeiro || null }) });
    if (!r.ok) linhas.push(`Telefone cadastrado: não consegui consultar (HTTP ${r.status})`);
    else {
      const [t] = await r.json().catch(() => []);
      if (t?.telefone) linhas.push(`${t.whatsapp ? 'WhatsApp' : 'Telefone'} cadastrado: +${t.telefone}`);
    }
  } catch (e) { linhas.push(`Telefone cadastrado: não consegui consultar (${String(e?.message || e).slice(0, 60)})`); }
  const j = await contatoNaJunta(imovel?.url_lote);
  if (!j.ok) linhas.push(`Junta Comercial: não consegui consultar (${j.erro})`);
  for (const c of (j.ok ? j.contatos : []).slice(0, 3)) {
    const tels = c.telefones.map(t => `${t.texto}${t.celular ? ' (celular)' : ''}`).join(' · ');
    linhas.push(`Junta Comercial${c.uf ? ` ${c.uf}` : ''}${c.nome ? ` — ${c.nome}` : ''}: ${[tels, c.email].filter(Boolean).join(' · ') || 'sem contato publicado'}`);
  }
  return linhas;
}

function montarMensagem(imovel, imovelId, { motivo, itens, destinatario, contatos = [] }) {
  const m = MOTIVO[motivo] || { porque: motivo, fazer: '' };
  const lote = imovel?.titulo || [imovel?.endereco, imovel?.cidade, imovel?.estado].filter(Boolean).join(', ') || `Lote ${imovelId}`;
  const linhas = [
    `Documentos do lote precisam da equipe: ${m.porque}`,
    '',
    `Lote: ${lote}${imovel?.cidade ? ` — ${imovel.cidade}/${imovel.estado || ''}` : ''}`,
    `Leiloeiro: ${imovel?.leiloeiro || imovel?.fonte || 'não identificado'}${destinatario ? ` (${destinatario})` : ''}`,
    contatos.length ? `Contato para ligar:\n${contatos.map(c => `• ${c}`).join('\n')}` : (motivo === 'falha' ? null : 'Contato para ligar: nenhum telefone cadastrado nem publicado pela Junta — procure no site do leiloeiro.'),
    itens?.length ? `Falta:\n${itens.map(i => `• ${i}`).join('\n')}` : null,
    dataLeilao(imovel || {}) ? `Leilão: ${dataLeilao(imovel)}` : null,
    imovel?.url_lote ? `Página do lote: ${imovel.url_lote}` : null,
    `Análise no app: ${APP_ORIGIN}/#/analise?imovel=${imovelId}`,
    '',
    m.fazer ? `O que fazer: ${m.fazer}` : null,
  ];
  return linhas.filter(l => l !== null).join('\n');
}

/**
 * Abre (ou atualiza) o chamado de documentos do lote e liga o pedido a ele.
 * @returns {{ ok: true, chamadoId: string, novo: boolean } | { ok: false, erro: string }}
 */
export async function abrirChamadoDocumentos({ imovelId, pedidoId = null, motivo, itens = [], destinatario = null }) {
  if (!imovelId || !/^[0-9a-f-]{36}$/i.test(String(imovelId))) return { ok: false, erro: 'imovel_id_invalido' };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, erro: 'configuracao_ausente' };
  try {
    const ri = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=titulo,endereco,cidade,estado,fonte,leiloeiro,url_lote,data_leilao,data_leilao_2,praca1_fim,praca2_fim&limit=1`);
    if (!ri.ok) throw new Error(`ler imovel HTTP ${ri.status}`);
    const [imovel] = await ri.json();

    let chamadoId = await chamadoAberto(imovelId);
    let novo = false;
    if (!chamadoId) {
      const lote = imovel?.titulo || [imovel?.cidade, imovel?.estado].filter(Boolean).join('/') || 'lote';
      const agora = new Date().toISOString();
      const rc = await sb('chamados', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          titulo: `📄 Documentos do leiloeiro — ${lote}`.slice(0, 200),
          tipo: TIPO_CHAMADO_DOCUMENTOS, origem: 'sistema', segmento: 'interno', canal: 'app',
          status: 'aberto', aberto_em: agora, atualizado_em: agora,
          user_id: null, user_nome: 'Sistema · pedido ao leiloeiro', imovel_id: imovelId,
        }),
      });
      if (rc.ok) {
        const [c] = await rc.json();
        chamadoId = c?.id || null;
        novo = !!chamadoId;
      } else if (rc.status === 409) {
        chamadoId = await chamadoAberto(imovelId); // outro pedido abriu no mesmo instante
      } else {
        throw new Error(`criar chamado HTTP ${rc.status} ${(await rc.text().catch(() => '')).slice(0, 120)}`);
      }
      if (!chamadoId) throw new Error('chamado não confirmado pelo banco');
    }

    // Sem repetir (05/11): cada cliente que abre o lote passava por aqui e o chamado de Tramandaí
    // juntou 3 mensagens idênticas. Mesmo motivo que a última mensagem do sistema nos últimos
    // 7 dias → não grava de novo; só o primeiro parágrafo (o motivo) é comparado.
    const cabeca = `Documentos do lote precisam da equipe: ${(MOTIVO[motivo] || { porque: motivo }).porque}`;
    let repetida = false;
    if (!novo) {
      const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const ru = await sb(`chamados_mensagens?chamado_id=eq.${chamadoId}&autor_tipo=eq.sistema&criado_em=gt.${encodeURIComponent(desde)}&conteudo=like.${encodeURIComponent('Documentos do lote precisam da equipe:*')}&select=conteudo&order=criado_em.desc&limit=1`);
      if (ru.ok) { const [u] = await ru.json().catch(() => []); repetida = !!u && String(u.conteudo).split('\n')[0] === cabeca; }
      else console.error('[chamado-documentos] ler última mensagem HTTP', ru.status); // sem ler, grava (repetir é melhor que sumir)
    }
    if (!repetida) {
      const rm = await sb('chamados_mensagens', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ chamado_id: chamadoId, autor_tipo: 'sistema', autor_nome: 'Sistema', conteudo: montarMensagem(imovel, imovelId, { motivo, itens, destinatario, contatos: await contatosParaLigar(imovel) }) }),
      });
      if (!rm.ok) console.error('[chamado-documentos] mensagem HTTP', rm.status);
    }
    if (!novo) {
      const ru = await sb(`chamados?id=eq.${chamadoId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ atualizado_em: new Date().toISOString() }) });
      if (!ru.ok) console.error('[chamado-documentos] atualizar chamado HTTP', ru.status);
    }
    if (pedidoId) {
      const rp = await sb(`documental_pedidos_leiloeiro?id=eq.${pedidoId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ chamado_id: chamadoId }) });
      // Sem o vínculo o gatilho não sabe o que foi pedido e não encerra o chamado sozinho.
      if (!rp.ok || !(await rp.json().catch(() => [])).length) console.error('[chamado-documentos] vincular pedido falhou', pedidoId, rp.status);
    }
    return { ok: true, chamadoId, novo };
  } catch (e) {
    console.error('[chamado-documentos] falhou:', String(e?.message || e).slice(0, 160));
    return { ok: false, erro: String(e?.message || e).slice(0, 120) };
  }
}

/** Mensagem de sistema num chamado já existente (ex.: resultado de um reenvio pela equipe). */
export async function registrarNoChamado(chamadoId, conteudo, { autorTipo = 'sistema', autorNome = 'Sistema', autorId = null } = {}) {
  if (!chamadoId || !SUPABASE_URL || !SERVICE_KEY) return false;
  const r = await sb('chamados_mensagens', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ chamado_id: chamadoId, autor_tipo: autorTipo, autor_nome: autorNome, autor_id: autorId, conteudo }),
  });
  if (!r.ok) console.error('[chamado-documentos] registrar HTTP', r.status);
  return r.ok;
}
