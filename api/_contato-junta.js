/**
 * CONTATO DO LEILOEIRO PELA JUNTA COMERCIAL (05/11, pedido do dono)
 *
 * Reserva para o chamado de documentos quando NÃO temos e-mail/telefone cadastrado: a lista oficial
 * das Juntas (`leiloeiro_junta`, carregada em 24–26/10) traz e-mail e telefone de ~2.080 leiloeiros.
 * Em 05/11, dos 261 leiloeiros com lote ativo e sem e-mail nosso, 237 casavam pelo domínio do site.
 *
 * O casamento é pelo HOST do link do lote contra o domínio que a Junta publica — o mesmo critério do
 * `leiloeiro_junta_recruzar` (compara tenants, não nome de fonte). O dado vai para a EQUIPE decidir
 * (mostrar, ligar, "usar este e-mail"); nada aqui manda e-mail sozinho para um endereço da Junta.
 *
 * Nunca lança. `{ ok:false, erro }` quando não conseguiu ler — "não consegui" não é "não tem" (forma #2).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Sufixos que sozinhos não identificam ninguém: casar "com.br" juntaria todos os leiloeiros do país.
const SUFIXO_PUBLICO = new Set(['com.br', 'lel.br', 'leilao.br', 'net.br', 'org.br', 'gov.br', 'adv.br', 'com', 'net', 'br']);

export function dominiosDoLink(url) {
  let host = '';
  try { host = new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return []; }
  const partes = host.split('.');
  const out = [];
  for (let i = 0; i < partes.length - 1; i++) {
    const d = partes.slice(i).join('.');
    if (!SUFIXO_PUBLICO.has(d)) out.push(d);
  }
  return out;
}

// "(51)3535-1000 | (51) 99997-2792" → números separados, com 55 na frente e palpite de celular.
export function telefonesDoTexto(txt) {
  const vistos = new Set();
  return String(txt || '').split(/[|/;,]| e /).map(p => {
    let d = p.replace(/\D/g, '');
    if (d.length === 12 || d.length === 13) d = d.replace(/^55/, '');
    if (d.length !== 10 && d.length !== 11) return null;
    if (vistos.has(d)) return null;
    vistos.add(d);
    return { texto: p.trim(), numero: `55${d}`, celular: d.length === 11 && d[2] === '9' };
  }).filter(Boolean);
}

/** @returns {Promise<{ok:true, contatos:Array<{nome,uf,email,telefones}>}|{ok:false, erro:string}>} */
export async function contatoNaJunta(urlLote) {
  const doms = dominiosDoLink(urlLote);
  if (!doms.length) return { ok: true, contatos: [] };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, erro: 'configuracao_ausente' };
  try {
    const lista = doms.map(d => `"${d}"`).join(',');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leiloeiro_junta?dominio=in.(${encodeURIComponent(lista)})&select=nome,uf,email,telefone,situacao&limit=12`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const linhas = await r.json();
    // A mesma pessoa aparece em várias Juntas (uma por UF onde tem matrícula): junta pelo e-mail+telefone.
    const porChave = new Map();
    for (const l of linhas) {
      if (!l.email && !l.telefone) continue;
      const email = l.email ? String(l.email).trim().toLowerCase() : null;
      const chave = `${email || ''}|${String(l.telefone || '').replace(/\D/g, '')}`;
      const atual = porChave.get(chave);
      if (atual) { if (l.uf && !atual.uf.includes(l.uf)) atual.uf.push(l.uf); continue; }
      porChave.set(chave, { nome: l.nome || null, uf: l.uf ? [l.uf] : [], email, telefones: telefonesDoTexto(l.telefone), situacao: l.situacao || null });
    }
    const contatos = [...porChave.values()].map(c => ({ ...c, uf: c.uf.join('/') }))
      .sort((a, b) => (b.situacao === 'ATIVO') - (a.situacao === 'ATIVO')).slice(0, 5);
    return { ok: true, contatos };
  } catch (e) {
    return { ok: false, erro: String(e?.message || e).slice(0, 120) };
  }
}
