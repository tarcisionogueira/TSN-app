/**
 * PEDIDO AUTOMÁTICO DE DOCUMENTO AO LEILOEIRO (05/10, regra do dono)
 *
 * "Um caso sem edital nem matrícula deveria solicitar via e-mail ao leiloeiro os documentos para
 * então poder gerar. Gerar relatório sem os documentos pode causar falhas."
 *
 * O documental já se recusa a sair sem matrícula + edital lidos (`precisaDocumentos`). Faltava o
 * passo seguinte quando a captura automática não resolve: pedir ao leiloeiro. Aqui o pedido sai
 * EM NOME DA EQUIPE (não do cliente), com reply-to `documentos+<token>@` — a resposta com o
 * arquivo entra sozinha no lote (api/inbound-juridico.js) e marca as análises que esperavam por
 * ela para regerar.
 *
 * EFICIÊNCIA SEM SOBRECARGA (05/10, dono: "temos que ser eficientes em cima daquilo que buscamos"):
 *  - só pela DEMANDA: quem chama é a geração do relatório de um cliente — nunca uma varredura do
 *    acervo (3.290 lotes sem matrícula viraria spam e queimaria o teto diário do Resend);
 *  - 1 pedido por LOTE a cada 7 dias, qualquer que seja o cliente;
 *  - teto por ENDEREÇO do leiloeiro: 3 por semana. O excedente fica `aguardando` e sai pela
 *    `drenarPedidosAguardando` (chamada pelo drenar-fila-emails-cron) quando a semana libera.
 *    Um e-mail por lote, de propósito: juntar lotes num e-mail só faria a resposta não casar com
 *    o lote (o anexo não diz de qual lote é);
 *  - quem não responde não recebe mais: 2 pedidos sem resposta (≥ 3 dias) em 30 dias → para o
 *    automático e o lote vai para a fila da equipe (`equipe_whatsapp`, no Admin), que tenta pelo
 *    WhatsApp;
 *  - leilão em menos de 48 h: não pede (a resposta não chegaria a tempo) — o cliente é orientado a
 *    anexar ou falar com o leiloeiro.
 *
 * Nunca lança: o chamador é a geração do relatório, e o pedido é acessório a ela. O retorno diz
 * O QUE aconteceu (`status`), inclusive a falha — não um null que se confunde com "não precisou".
 */
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || 'bidprobrasil.com.br';
const DIA = 86_400_000;
const JANELA_LOTE_DIAS = 7;
const TETO_SEMANA_ENDERECO = 3;
const SEM_RESPOSTA_MAX = 2;          // pedidos sem resposta em 30 dias que fazem parar
const PRAZO_RESPOSTA_DIAS = 3;       // antes disso, "sem resposta" ainda é só "ainda não respondeu"
const PRAZO_MIN_LEILAO_H = 48;
const ROTULO = { matricula: 'Matrícula atualizada do imóvel', edital: 'Edital do leilão', regras_venda: 'Regras de venda' };
const ROTULO_PARA_TIPO = Object.fromEntries(Object.entries(ROTULO).map(([k, v]) => [v, k]));
// Status que "ocupam" o lote na janela de 7 dias (dedup).
const STATUS_ATIVOS = 'enviado,represado,sem_contato,aguardando,equipe_whatsapp';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function lerJson(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

// Próxima data de leilão no futuro (null = sem data conhecida ou tudo no passado).
const SEL_IMOVEL = 'fonte,leiloeiro,titulo,endereco,cidade,estado,url_lote,link_edital,numero_processo,data_leilao,data_leilao_2,praca1_fim,praca2_fim,tem_matricula_doc,tem_edital_doc';
function proximoLeilao(im) {
  const agora = Date.now();
  const datas = [im.praca1_fim, im.praca2_fim, im.data_leilao, im.data_leilao_2].map((v) => {
    const t = String(v || '');
    const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    const ms = br ? Date.parse(`${br[3]}-${br[2]}-${br[1]}T23:59:00-03:00`) : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T23:59:00-03:00` : t);
    return Number.isFinite(ms) ? ms : null;
  }).filter((ms) => ms != null);
  if (!datas.length) return { semData: true };
  const futuras = datas.filter((ms) => ms > agora).sort((a, b) => a - b);
  return futuras.length ? { ms: futuras[0] } : { encerrado: true };
}

// Situação do ENDEREÇO do leiloeiro: estourou o teto da semana? parou de responder?
async function situacaoEndereco(email) {
  const desde = new Date(Date.now() - 30 * DIA).toISOString();
  const linhas = await lerJson(`documental_pedidos_leiloeiro?destinatario_email=eq.${encodeURIComponent(email)}&criado_em=gt.${encodeURIComponent(desde)}&status=in.(enviado,represado)&select=criado_em,respondido_em&order=criado_em.desc&limit=50`);
  const semana = Date.now() - 7 * DIA;
  const enviadosSemana = linhas.filter((l) => Date.parse(l.criado_em) > semana).length;
  // Só conta o silêncio DEPOIS da última resposta: quem respondeu ontem não é "quem não responde".
  const ultimaResposta = Math.max(0, ...linhas.map((l) => (l.respondido_em ? Date.parse(l.respondido_em) : 0)));
  const prazo = Date.now() - PRAZO_RESPOSTA_DIAS * DIA;
  const semResposta = linhas.filter((l) => !l.respondido_em && Date.parse(l.criado_em) > ultimaResposta && Date.parse(l.criado_em) < prazo).length;
  return { tetoCheio: enviadosSemana >= TETO_SEMANA_ENDERECO, naoResponde: semResposta >= SEM_RESPOSTA_MAX };
}

function montarTexto(imovel, itensTexto) {
  const lote = imovel.titulo || [imovel.endereco, imovel.cidade, imovel.estado].filter(Boolean).join(', ') || 'Lote';
  const link = imovel.url_lote || imovel.link_edital || '';
  const texto = `Prezados,\n\nA equipe da BidPro Brasil está analisando o lote abaixo para um cliente interessado e não localizou na página do leilão o(s) documento(s) a seguir:\n\n${itensTexto.map(t => `• ${t}`).join('\n')}\n\nLote: ${lote}${link ? `\nPágina do lote: ${link}` : ''}${imovel.numero_processo ? `\nProcesso: ${imovel.numero_processo}` : ''}\n\nPoderiam, por gentileza, responder a este e-mail com o(s) arquivo(s) em anexo (PDF)?\n\nAgradecemos a atenção.\n\nEquipe BidPro Brasil`;
  return { texto, assunto: `Documentação do lote — ${lote}${imovel.numero_processo ? ` (proc. ${imovel.numero_processo})` : ''}` };
}

async function enviar(email, imovel, itensTexto, userId) {
  const { texto, assunto } = montarTexto(imovel, itensTexto);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const token = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await enviarEmail({
    to: email,
    replyTo: `documentos+${token}@${INBOUND_DOMAIN}`,
    subject: assunto,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;white-space:pre-wrap;line-height:1.6">${esc(texto)}</div>`,
    text: texto,
    meta: { tipo: 'pedido_documento_leiloeiro_auto', userId },
  });
  const status = r.ok ? 'enviado' : r.enfileirado ? 'represado' : 'falha';
  return { status, texto_enviado: texto, resend_id: r.ok ? (r.id || null) : null, resposta_token: status === 'falha' ? null : token, erro: r.ok ? null : (r.error || null) };
}

async function gravar(linha) {
  const r = await sb('documental_pedidos_leiloeiro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(linha) });
  // Sem a linha, a resposta do leiloeiro não casa com o lote — e o dedup não segura o próximo envio.
  if (!r.ok) console.error('[pedido-leiloeiro-auto] gravar pedido HTTP', r.status, linha.status);
  return r.ok;
}

export async function pedirDocumentosAoLeiloeiro({ imovelId, userId, faltando }) {
  const itens = [...new Set(faltando || [])].filter(t => ROTULO[t]);
  if (!itens.length || !imovelId || !userId) return { status: 'nada_a_pedir' };
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: 'erro', erro: 'configuracao_ausente' };
  try {
    const desde = new Date(Date.now() - JANELA_LOTE_DIAS * DIA).toISOString();
    const [ja] = await lerJson(`documental_pedidos_leiloeiro?imovel_id=eq.${encodeURIComponent(imovelId)}&criado_em=gt.${encodeURIComponent(desde)}&status=in.(${STATUS_ATIVOS})&select=criado_em,status,respondido_em&order=criado_em.desc&limit=1`);
    if (ja) return { status: ja.status === 'enviado' || ja.status === 'represado' ? 'ja_pedido' : ja.status, em: ja.criado_em, respondidoEm: ja.respondido_em || null };

    const [imovel] = await lerJson(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=${SEL_IMOVEL}&limit=1`);
    if (!imovel) return { status: 'erro', erro: 'imovel_nao_encontrado' };
    // Caixa tem pipeline próprio (matrícula estática + fila de captura) e não responde e-mail de lote.
    if (/caixa|cef/i.test(imovel.fonte || '')) return { status: 'nada_a_pedir' };
    const prox = proximoLeilao(imovel);
    if (prox.encerrado) return { status: 'nada_a_pedir' };
    if (prox.ms && prox.ms - Date.now() < PRAZO_MIN_LEILAO_H * 3_600_000) return { status: 'prazo_curto' };

    const rc = await sb('rpc/contato_leiloeiro_resolver', { method: 'POST', body: JSON.stringify({ p_fonte: imovel.fonte || '', p_leiloeiro: imovel.leiloeiro || null }) });
    if (!rc.ok) return { status: 'erro', erro: `contato HTTP ${rc.status}` };
    const [contato] = await rc.json();
    const itensTexto = itens.map(t => ROTULO[t]);
    const base = { imovel_id: String(imovelId), user_id: userId, fonte: imovel.fonte || null, itens_pedidos: itensTexto, automatico: true };

    if (!contato?.email) { await gravar({ ...base, status: 'sem_contato' }); return { status: 'sem_contato' }; }
    const email = String(contato.email).trim().toLowerCase();
    const sit = await situacaoEndereco(email);
    if (sit.naoResponde) { await gravar({ ...base, destinatario_email: email, status: 'equipe_whatsapp' }); return { status: 'equipe_whatsapp' }; }
    if (sit.tetoCheio) { await gravar({ ...base, destinatario_email: email, status: 'aguardando' }); return { status: 'aguardando', em: new Date().toISOString() }; }

    const env = await enviar(email, imovel, itensTexto, userId);
    await gravar({ ...base, destinatario_email: email, texto_enviado: env.texto_enviado, resend_id: env.resend_id, status: env.status, resposta_token: env.resposta_token });
    return env.status === 'falha' ? { status: 'falha', erro: env.erro || 'falha_envio' } : { status: env.status, em: new Date().toISOString() };
  } catch (e) {
    console.error('[pedido-leiloeiro-auto] falhou:', String(e?.message || e).slice(0, 160));
    return { status: 'erro', erro: String(e?.message || e).slice(0, 120) };
  }
}

/**
 * Fonte que comprovadamente NÃO publica matrícula (≥ 20 lotes ativos e < 10% com matrícula):
 * esperar a captura automática (~2 h) não adianta — o pedido sai já no primeiro clique.
 * Medido pelo acervo, sem lista à mão: fonte que passar a publicar sai sozinha da regra.
 */
const cacheFonte = new Map();
export async function fonteNaoPublicaMatricula(fonte) {
  if (!fonte || !SUPABASE_URL || !SERVICE_KEY) return false;
  if (cacheFonte.has(fonte)) return cacheFonte.get(fonte);
  try {
    const contar = async (filtro) => {
      const r = await sb(`imoveis_leilao?fonte=eq.${encodeURIComponent(fonte)}&ativo=eq.true${filtro}&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      if (!r.ok) throw new Error(`contagem HTTP ${r.status}`);
      return Number((r.headers.get('content-range') || '').split('/')[1]);
    };
    const [total, comMatricula] = await Promise.all([contar(''), contar('&tem_matricula_doc=eq.true')]);
    const nao = Number.isFinite(total) && Number.isFinite(comMatricula) && total >= 20 && comMatricula / total < 0.1;
    cacheFonte.set(fonte, nao);
    return nao;
  } catch (e) {
    // Sem a medição, cai no comportamento padrão (espera a captura) — não pede às cegas.
    console.error('[pedido-leiloeiro-auto] fonteNaoPublicaMatricula:', String(e?.message || e).slice(0, 120));
    return false;
  }
}

/**
 * Fila `aguardando` (teto semanal do endereço cheio na hora do pedido): sai quando a semana libera.
 * Chamada pelo drenar-fila-emails-cron. Antes de mandar, re-confere tudo — o documento pode ter
 * chegado, o leilão pode estar perto, o leiloeiro pode ter parado de responder.
 */
export async function drenarPedidosAguardando({ max = 10 } = {}) {
  const out = { lidos: 0, enviados: 0, dispensados: 0, equipe: 0, seguem: 0, falhas: 0 };
  if (!SUPABASE_URL || !SERVICE_KEY) return out;
  const fila = await lerJson(`documental_pedidos_leiloeiro?status=eq.aguardando&automatico=eq.true&order=criado_em.asc&limit=${max}&select=id,imovel_id,user_id,destinatario_email,itens_pedidos`);
  out.lidos = fila.length;
  const situacao = new Map();
  for (const p of fila) {
    const marcar = async (campos) => {
      const r = await sb(`documental_pedidos_leiloeiro?id=eq.${p.id}&status=eq.aguardando`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(campos) });
      const ok = r.ok && (await r.json().catch(() => [])).length === 1;
      if (!ok) console.error('[pedido-leiloeiro-auto] drenar: não marquei', p.id, r.status);
      return ok;
    };
    try {
      const [imovel] = await lerJson(`imoveis_leilao?id=eq.${encodeURIComponent(p.imovel_id)}&select=${SEL_IMOVEL}&limit=1`);
      const itens = (Array.isArray(p.itens_pedidos) ? p.itens_pedidos : []).filter((rot) => {
        const t = ROTULO_PARA_TIPO[rot];
        return !(t === 'matricula' && imovel?.tem_matricula_doc) && !(t === 'edital' && imovel?.tem_edital_doc);
      });
      const prox = imovel ? proximoLeilao(imovel) : { encerrado: true };
      if (!itens.length || prox.encerrado || (prox.ms && prox.ms - Date.now() < PRAZO_MIN_LEILAO_H * 3_600_000)) {
        await marcar({ status: !itens.length ? 'dispensado' : 'prazo_curto' }); out.dispensados++; continue;
      }
      if (!situacao.has(p.destinatario_email)) situacao.set(p.destinatario_email, await situacaoEndereco(p.destinatario_email));
      const sit = situacao.get(p.destinatario_email);
      if (sit.naoResponde) { await marcar({ status: 'equipe_whatsapp' }); out.equipe++; continue; }
      if (sit.tetoCheio) { out.seguem++; continue; }
      const env = await enviar(p.destinatario_email, imovel, itens, p.user_id);
      if (env.status === 'falha') { out.falhas++; console.error('[pedido-leiloeiro-auto] drenar: envio falhou', p.id, env.erro); continue; }
      await marcar({ status: env.status, texto_enviado: env.texto_enviado, resend_id: env.resend_id, resposta_token: env.resposta_token, itens_pedidos: itens, criado_em: new Date().toISOString() });
      out.enviados++;
      situacao.delete(p.destinatario_email); // o envio mudou a conta da semana: relê na próxima
    } catch (e) {
      out.falhas++;
      console.error('[pedido-leiloeiro-auto] drenar:', p.id, String(e?.message || e).slice(0, 120));
    }
  }
  return out;
}

// Frase para o cliente, a partir do retorno de `pedirDocumentosAoLeiloeiro`. '' quando não há o que dizer.
export function fraseDoPedido(p) {
  if (!p) return '';
  const data = p.em ? new Date(p.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  if (['enviado', 'represado', 'ja_pedido'].includes(p.status)) {
    return ` Pedimos o documento ao leiloeiro por e-mail${data ? ` em ${data}` : ''}: quando ele responder, o arquivo entra no lote e a análise é gerada automaticamente.`;
  }
  if (p.status === 'aguardando') return ' O pedido ao leiloeiro já está na fila de envio: quando ele responder, o arquivo entra no lote e a análise é gerada automaticamente.';
  if (p.status === 'equipe_whatsapp') return ' Nossa equipe vai pedir o documento diretamente ao leiloeiro; quando chegar, a análise é gerada automaticamente.';
  if (p.status === 'prazo_curto') return ' Como o leilão é em menos de 48 horas, não há tempo para o leiloeiro responder por e-mail: anexe o documento ou fale direto com o leiloeiro.';
  return '';
}
