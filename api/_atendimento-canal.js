// CANAIS DE ATENDIMENTO HUMANO DO CLIENTE (06/11, pedido do dono + cláusula de comunicação do termo).
//
// O cliente fala primeiro com a IA e, quando quiser, escolhe a EQUIPE (vai para o dono) ou o ADVOGADO
// do caso dele. O advogado hoje NÃO tem conta (0 perfis com role=advogado; o escritório entra por
// casos.acompanhamento_para), então a conversa com ele passa por E-MAIL: sai com reply-to
// suporte+<token>@ e a resposta volta para o MESMO chamado pelo api/inbound-juridico.js.
// O e-mail do advogado nunca vai para o navegador do cliente: só o servidor resolve o destino.
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br').trim().toLowerCase();

export const TIPO_JURIDICO_CLIENTE = 'juridico_cliente';

export function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

// Lê e LANÇA em não-2xx: "não consegui ler" não pode virar "este cliente não tem advogado".
export async function lerLista(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura HTTP ${r.status}: ${path.split('?')[0]}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const limpos = (l) => [...new Set((l || []).map((e) => String(e).trim().toLowerCase()).filter(emailOk))];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function emailDaConta(id) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`conta do advogado HTTP ${r.status}`);
  return (await r.json().catch(() => null))?.email || null;
}

// Para quem vai a mensagem deste caso. Conta de advogado primeiro; sem conta, os e-mails do caso.
export async function destinosDoCaso(caso) {
  if (caso.advogado_id) {
    const lista = await lerLista(`juridico_destinatarios?advogado_id=eq.${caso.advogado_id}&ativo=eq.true&select=email,copia&order=copia.asc,criado_em.asc`);
    const para = limpos(lista.filter((d) => !d.copia).map((d) => d.email));
    const cc = limpos(lista.filter((d) => d.copia).map((d) => d.email));
    if (para.length) return { para, cc };
    if (cc.length) return { para: [cc[0]], cc: cc.slice(1) };
    const daConta = await emailDaConta(caso.advogado_id);
    if (emailOk(daConta)) return { para: [String(daConta).toLowerCase()], cc: [] };
  }
  return { para: limpos(caso.acompanhamento_para), cc: limpos(caso.acompanhamento_cc) };
}

const COLUNAS_CASO = 'id,cliente_id,imovel_endereco,advogado_id,acompanhamento_para,acompanhamento_cc,acompanhamento_liberado_em';

// Interruptor do canal com o advogado. Sem a chave, ou com outro valor, fica DESLIGADO: ligar manda e-mail de cliente
// a escritório real, então só depois de testar com uma caixa externa e combinar com o escritório.
// Liga em app_config: atendimento_advogado_ligado = 'true'. Leitura que falha LANÇA: não vira "não tem advogado".
export async function canalAdvogadoLigado() {
  const [c] = await lerLista('app_config?key=eq.atendimento_advogado_ligado&select=value&limit=1');
  return String(c?.value || '').trim() === 'true';
}

export async function casoDoCliente(casoId, userId) {
  const [caso] = await lerLista(`casos?id=eq.${encodeURIComponent(casoId)}&cliente_id=eq.${userId}&select=${COLUNAS_CASO}&limit=1`);
  return caso || null;
}

// O que o cliente pode escolher. Só entra caso com destino que dá para alcançar de verdade:
// oferecer um advogado sem e-mail seria um botão que afirma o que o sistema não faz.
export async function advogadosDoCliente(userId) {
  if (!(await canalAdvogadoLigado())) return [];
  const casos = await lerLista(`casos?cliente_id=eq.${userId}&or=(advogado_id.not.is.null,acompanhamento_para.not.is.null)&select=${COLUNAS_CASO}&order=created_at.desc&limit=20`);
  const saida = [];
  for (const c of casos) {
    // Escritório só em e-mail de acompanhamento conta depois que o acompanhamento foi liberado.
    if (!c.advogado_id && !c.acompanhamento_liberado_em) continue;
    const { para } = await destinosDoCaso(c);
    if (!para.length) continue;
    let nome = 'Advogado do caso';
    if (c.advogado_id) {
      const [e] = await lerLista(`advogado_escritorio?advogado_id=eq.${c.advogado_id}&select=razao_social,oab&limit=1`);
      const [p] = await lerLista(`perfis?id=eq.${c.advogado_id}&select=nome&limit=1`);
      nome = e?.razao_social || p?.nome || nome;
      if (e?.oab) nome = `${nome} (OAB ${e.oab})`;
    }
    saida.push({ caso_id: c.id, imovel: c.imovel_endereco || 'Seu caso', nome });
  }
  return saida;
}

function carta(paragrafos, assinatura = ['BidPro Brasil']) {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:640px">${
    paragrafos.map((p) => `<p style="white-space:pre-wrap">${esc(p)}</p>`).join('')}<p>${assinatura.map(esc).join('<br>')}</p></div>`;
  return { html, text: [...paragrafos, assinatura.join('\n')].join('\n\n') };
}

const replyDoFio = (token) => `suporte+${token}@bidprobrasil.com.br`;

export async function emailAoAdvogado({ chamado, caso, clienteNome, texto, chaveEnvio }) {
  const { para, cc } = await destinosDoCaso(caso);
  if (!para.length) return { ok: false, error: 'caso sem e-mail do advogado' };
  const imovel = caso.imovel_endereco || 'imóvel do caso';
  const { html, text } = carta([
    'Prezado(a) Doutor(a),',
    `${clienteNome || 'O cliente'}, assessorado(a) da BidPro Brasil, enviou esta mensagem sobre o caso do imóvel ${imovel}:`,
    texto,
    'Para responder, basta responder a este e-mail. A sua resposta chega ao cliente pelo Atendimento da plataforma e fica registrada no caso.',
    'Pedimos o retorno em até 3 dias úteis. Se não for possível, avise a equipe respondendo a este e-mail.',
    'Atenciosamente,',
  ]);
  return enviarEmail({
    from: 'BidPro Brasil Jurídico <contato@bidprobrasil.com.br>', to: para, cc: cc.length ? cc : undefined,
    replyTo: replyDoFio(chamado.email_token), subject: `Mensagem do cliente — ${imovel}`, html, text,
    meta: { tipo: 'atendimento_advogado', userId: chamado.user_id }, idempotencyKey: chaveEnvio,
  });
}

// Quem pode responder no fio do advogado: só os destinos do caso. Outro remetente não fala em nome dele ao cliente.
export async function remetenteDoCaso(caso, endereco) {
  const { para, cc } = await destinosDoCaso(caso);
  return [...para, ...cc].includes(String(endereco || '').trim().toLowerCase());
}

export function emailAoClienteOportunidade({ para, nome, userId, cidade, uf, chaveEnvio }) {
  const onde = cidade ? ` em ${cidade}${uf ? `/${uf}` : ''}` : '';
  const { html, text } = carta([
    `Olá${nome ? `, ${nome}` : ''},`,
    `A equipe selecionou um imóvel${onde} que combina com o seu perfil de investidor.`,
    `Para ver os detalhes e responder se quer levar para a reunião de apresentação, entre na plataforma: ${APP_URL}. O cartão está no alto da tela inicial.`,
    'Responder não é lance e não compra nada.',
    'Atenciosamente,',
  ], ['Equipe BidPro Brasil']);
  return enviarEmail({
    from: 'BidPro Brasil <noreply@bidprobrasil.com.br>', to: [para], subject: 'Selecionamos um imóvel para você avaliar', html, text,
    meta: { tipo: 'oportunidade_selecionada', userId }, idempotencyKey: chaveEnvio,
  });
}

export function emailAEquipeOportunidade({ decisao, titulo, clienteEmail, motivo, avisos = [] }) {
  const aprovou = decisao === 'aprovada';
  const { html, text } = carta([
    'Olá,',
    `${clienteEmail} ${aprovou ? 'aprovou para a reunião de apresentação' : 'recusou'} a oportunidade: ${titulo}.`,
    aprovou ? `A aprovação não autoriza lance. Marque a reunião pela fila de solicitações: ${APP_URL}/#/admin` : (motivo ? `Motivo informado: ${motivo}` : 'O cliente não informou motivo.'),
    ...(avisos.length ? [`Atenção: ${avisos.join('; ')}.`] : []),
  ]);
  return enviarEmail({
    from: 'BidPro Brasil <noreply@bidprobrasil.com.br>', to: [ADMIN_EMAIL],
    subject: `Oportunidade ${aprovou ? 'aprovada' : 'recusada'} — ${titulo}`.slice(0, 180), html, text, meta: { tipo: 'oportunidade_decisao' },
  });
}

export async function emailAEquipe({ chamado, clienteNome, texto, motivo }) {
  const { html, text } = carta([
    'Olá,',
    `${clienteNome || chamado.user_nome || 'Um cliente'} pediu atendimento humano. ${motivo || ''}`.trim(),
    `Mensagem do cliente:\n${texto}`,
    `Responda pela tela de Atendimento: ${APP_URL}/#/atendimento`,
  ]);
  return enviarEmail({
    from: 'BidPro Brasil <noreply@bidprobrasil.com.br>', to: [ADMIN_EMAIL],
    subject: `Cliente pediu atendimento — ${chamado.titulo || chamado.user_nome || 'chamado'}`, html, text,
    meta: { tipo: 'atendimento_equipe' },
  });
}

export async function emailAoClienteRespostaDoAdvogado({ chamado, autorNome, texto }) {
  if (!chamado.user_email) return { ok: false, error: 'chamado sem e-mail do cliente' };
  const { html, text } = carta([
    `Olá${chamado.user_nome ? `, ${chamado.user_nome}` : ''},`,
    `${autorNome || 'O advogado do seu caso'} respondeu à sua mensagem:`,
    texto,
    `Você pode responder a este e-mail ou continuar pelo botão Atendimento da plataforma: ${APP_URL}`,
    'Atenciosamente,',
  ]);
  return enviarEmail({
    from: 'BidPro Brasil <noreply@bidprobrasil.com.br>', to: [chamado.user_email],
    replyTo: replyDoFio(chamado.email_token), subject: `Resposta do advogado — ${chamado.titulo || 'seu caso'}`, html, text,
    meta: { tipo: 'atendimento_advogado', userId: chamado.user_id },
  });
}
