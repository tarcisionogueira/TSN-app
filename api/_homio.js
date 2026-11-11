/**
 * Regras PURAS da integração com a Homio (11/11) — sem rede, sem banco, testadas em
 * `scripts/testes/homio-lead.mjs`. Quem faz I/O é `api/homio-lead.js`, `api/ativar-conta.js`
 * e `api/homio-reenvio-cron.js`.
 *
 * A Homio (CRM do lançamento) chama `POST /api/homio-lead` quando alguém preenche o formulário da
 * página dela. O formato exato do corpo depende de como a automação foi montada lá (webhook
 * padrão com o contato inteiro, ou "webhook personalizado" com campos escolhidos à mão), então a
 * leitura aceita os nomes mais comuns de cada campo em vez de exigir um formato só — e devolve o
 * que NÃO conseguiu ler, para a rota responder 400 dizendo qual campo faltou.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const texto = (v) => (v == null ? '' : String(v)).trim();

function primeiro(obj, chaves) {
  for (const k of chaves) {
    const v = texto(obj?.[k]);
    if (v) return v;
  }
  return '';
}

/**
 * Lê o corpo enviado pela Homio. Aceita os campos no nível de cima ou dentro de `contact`,
 * em português ou inglês, e a atribuição (utm) solta, em `utm` ou em `attributionSource`.
 * Devolve `{ email, nome, telefone, contactId, utm, faltando }` — `faltando` lista o que
 * impede criar a conta (hoje só o e-mail; nome e telefone o popup de cadastro pede depois).
 */
export function lerLeadHomio(corpo) {
  const b = (corpo && typeof corpo === 'object') ? corpo : {};
  const c = (b.contact && typeof b.contact === 'object') ? b.contact : {};
  const fontes = [b, c];
  const pegar = (chaves) => { for (const f of fontes) { const v = primeiro(f, chaves); if (v) return v; } return ''; };

  const email = pegar(['email', 'e_mail', 'Email']).toLowerCase().slice(0, 160);

  let nome = pegar(['nome', 'nome_completo', 'full_name', 'fullName', 'name', 'contact_name']);
  if (!nome) {
    const n1 = pegar(['first_name', 'firstName', 'primeiro_nome']);
    const n2 = pegar(['last_name', 'lastName', 'sobrenome']);
    nome = [n1, n2].filter(Boolean).join(' ');
  }
  nome = nome.replace(/\s+/g, ' ').slice(0, 120);

  const telefone = pegar(['telefone', 'whatsapp', 'celular', 'phone', 'phone_number', 'phoneNumber']).slice(0, 25);
  const contactId = pegar(['contact_id', 'contactId', 'id_contato']) || texto(c.id) || '';

  const utm = {};
  const atrib = [b.utm, b.attributionSource, c.attributionSource, b.contact_source && { utm_source: b.contact_source }, b, c]
    .filter((x) => x && typeof x === 'object');
  const CAMPOS = {
    utm_source: ['utm_source', 'utmSource'], utm_medium: ['utm_medium', 'utmMedium'],
    utm_campaign: ['utm_campaign', 'utmCampaign', 'campaign'], utm_content: ['utm_content', 'utmContent'],
    utm_term: ['utm_term', 'utmTerm'], gclid: ['gclid'], fbclid: ['fbclid'],
  };
  for (const [campo, nomes] of Object.entries(CAMPOS)) {
    for (const a of atrib) { const v = primeiro(a, nomes); if (v) { utm[campo] = v.slice(0, 200); break; } }
  }

  const faltando = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) faltando.push('email');
  return { email, nome, telefone, contactId: contactId.slice(0, 80), utm, faltando };
}

/** Campanha vem da URL do webhook (`?campanha=...`), não do corpo: quem decide é quem configurou. */
export function campanhaDe(valor) {
  const v = texto(valor).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return v || 'lancamento';
}

/** Compara o segredo sem vazar tempo. Segredo não configurado = recusa (falha fechada). */
export function segredoConfere(recebido, esperado) {
  const a = Buffer.from(texto(recebido));
  const b = Buffer.from(texto(esperado));
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Token de ativação DERIVADO do id do lead (HMAC com o segredo do servidor): dá para remontar o
 * mesmo link a qualquer momento (reenvio do e-mail, aviso repetido à Homio) sem guardar o token
 * cru no banco — lá fica só o hash, que é por onde a rota de ativação encontra o lead.
 * Trocar o segredo invalida os links já enviados (é o efeito desejado se ele vazar).
 */
export function tokenAtivacao(leadId, segredo) {
  if (!texto(leadId) || !texto(segredo)) return null;
  const token = createHmac('sha256', texto(segredo)).update(`ativacao:${texto(leadId)}`).digest('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return createHash('sha256').update(texto(token)).digest('hex');
}

export const VALIDADE_ATIVACAO_DIAS = 30;

/**
 * O que a rota de ativação faz com o lead achado pelo token.
 * `gerar_link` = abrir a definição de senha; `login` = a pessoa já definiu a senha dela;
 * `expirado`/`invalido` = mandar ao login (lá existe "esqueci minha senha").
 * A ATIVAÇÃO não é marcada no clique: leitor de link de antivírus/Outlook "clica" sozinho.
 * Quem marca é o cron, quando `perfis.senha_pendente` vira false (a pessoa definiu a senha).
 */
export function decidirAtivacao(lead, agora = Date.now(), senhaPendente = true) {
  if (!lead || !lead.user_id) return 'invalido';
  if (senhaPendente === false) return 'login';
  if (lead.token_expira_em && Date.parse(lead.token_expira_em) < agora) return 'expirado';
  return 'gerar_link';
}

/** Corpo do aviso à Homio. O link só vai no evento `conta_criada` (é ele que a Homio pode mandar por e-mail). */
export function corpoAvisoHomio(evento, lead, linkAtivacao = null) {
  return {
    evento,
    campanha: lead?.campanha || null,
    email: lead?.email || null,
    nome: lead?.nome || null,
    telefone: lead?.telefone || null,
    contact_id: lead?.homio_contact_id || null,
    ...(evento === 'conta_criada' && linkAtivacao ? { link_ativacao: linkAtivacao } : {}),
    em: new Date().toISOString(),
  };
}
