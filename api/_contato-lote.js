// CONTATO DO RESPONSÁVEL PELO LOTE, lido da PÁGINA do lote (30/09).
//
// Por que existe: em plataforma MULTI-TENANT (Superbid) quem vende não é "a Superbid" — cada
// evento tem um ORGANIZADOR próprio (ex.: "SOLD MAISATIVO", atendimento.infraenergia@superbid.net),
// e o contato genérico da fonte é o destinatário ERRADO. Medido no mesmo dia: a proposta de
// 24/09 de um lote da AZ LEILÕES saiu para o e-mail de outro leiloeiro. O caminho manual que o
// dono segue na tela é "página do lote → Dúvidas e contato → Sobre o evento"; o dado está no
// `__NEXT_DATA__` da mesma página: `eventDetails.events[id = auction.id]` → `managerName` e
// `ticker` ("telefone :: e-mail :: whatsapp :: ...").
//
// A Superbid devolve 403 à Vercel e 200 ao banco (medido 30/09) → leitura VIA BANCO
// (pagina_pedir/pagina_ler, só service_role), o mesmo par de RPCs do motor de coleta.
// Nunca lança: devolve { contato | null, motivo } — "não achei" e "não consegui ler" saem com
// motivos distintos, para a tela não dizer "sem contato cadastrado" quando a leitura falhou.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function rpc(nome, args) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

// Nunca lança; { html } ou { html: null, motivo }.
export async function paginaViaBanco(url, deadline) {
  try {
    const rp = await rpc('pagina_pedir', { p_url: url });
    if (!rp.ok) return { html: null, motivo: `pagina_pedir HTTP ${rp.status}` };
    const id = await rp.json();
    while (Date.now() < deadline - 1000) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const rl = await rpc('pagina_ler', { p_id: id });
      if (!rl.ok) return { html: null, motivo: `pagina_ler HTTP ${rl.status}` };
      const [row] = await rl.json();
      if (!row?.pronto) continue;
      return row.status >= 200 && row.status < 300 && row.conteudo ? { html: row.conteudo } : { html: null, motivo: row.erro || `HTTP ${row.status}` };
    }
    return { html: null, motivo: 'sem resposta no prazo' };
  } catch (e) { return { html: null, motivo: String(e?.message || e).slice(0, 60) }; }
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_FONE = /\+?\d[\d\s().-]{7,}\d/;

// Puro (testável): extrai o organizador do evento `auctionId` do HTML da oferta Superbid.
export function contatoDoEventoSuperbid(html, auctionId) {
  const m = String(html || '').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { contato: null, motivo: 'página sem __NEXT_DATA__ (estrutura mudou?)' };
  let dados;
  try { dados = JSON.parse(m[1]); } catch { return { contato: null, motivo: '__NEXT_DATA__ ilegível' }; }
  const alvo = String(auctionId || '');
  // O evento (ticker + managerName) e, quando houver, os `internalParameters` de uma oferta do
  // MESMO evento (contactEmailAddress/Phone/Whatsapp — medido 30/09: a oferta aberta não os
  // traz, as ofertas relacionadas do mesmo evento sim). Nunca de outro evento.
  let evento = null, params = null;
  const visitar = (o, prof = 0) => {
    if (!o || typeof o !== 'object' || prof > 30) return;
    if (!Array.isArray(o)) {
      if (!evento && ('ticker' in o || 'managerName' in o) && String(o.id) === alvo) evento = o;
      const ip = o.internalParameters;
      if (!params && ip && typeof ip === 'object' && !Array.isArray(ip) && ip.contactEmailAddress && String(o.auction?.id ?? '') === alvo) params = ip;
    }
    for (const v of Object.values(o)) visitar(v, prof + 1);
  };
  visitar(dados);
  if (!evento && !params) return { contato: null, motivo: `evento ${alvo || '(sem id)'} não encontrado na página` };
  evento = evento || {}; params = params || {};

  const partes = String(evento.ticker || '').split('::').map((s) => s.trim()).filter(Boolean);
  const email = (params.contactEmailAddress || partes.find((p) => RE_EMAIL.test(p)) || '').match(RE_EMAIL)?.[0] || null;
  const telefone = params.contactPhoneNumber || partes.find((p) => !RE_EMAIL.test(p) && RE_FONE.test(p)) || null;
  const whatsapp = params.contactWhatsappNumber || partes.filter((p) => !RE_EMAIL.test(p) && RE_FONE.test(p))[1] || null;
  return {
    contato: {
      email, telefone, whatsapp,
      organizador: evento.managerName || null,
      evento: evento.desc || null,
      caminho: 'Superbid → página do lote → "Dúvidas e contato" → "Sobre o evento" (organizador do evento)',
    },
    motivo: email ? null : 'evento sem e-mail publicado',
  };
}

// Só as fontes em que o contato é POR EVENTO na página; as demais usam o cadastro.
export function fonteComContatoNaPagina(fonte) {
  return /^SUPERBID$/i.test(String(fonte || ''));
}

export async function contatoDaPaginaDoLote({ fonte, linkLote, auctionId }, deadline = Date.now() + 15000) {
  if (!fonteComContatoNaPagina(fonte)) return { contato: null, motivo: 'fonte sem contato por evento' };
  if (!/^https?:\/\//i.test(String(linkLote || ''))) return { contato: null, motivo: 'lote sem link' };
  if (!auctionId) return { contato: null, motivo: 'lote sem id do evento (raw.auction.id)' };
  const b = await paginaViaBanco(linkLote, deadline);
  if (!b.html) return { contato: null, motivo: `página do lote indisponível (${b.motivo})` };
  return contatoDoEventoSuperbid(b.html, auctionId);
}
