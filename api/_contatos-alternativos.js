// QUANDO O ENDEREÇO DO LEILOEIRO ESTÁ BLOQUEADO, QUEM RESPONDE? (02/10, dono)
//
// O dono tentou propor um FIAT para `atendimento.infraenergia@superbid.net` lembrando que "foi o
// mesmo e-mail que respondeu no caso da Oroch". Não foi: a proposta da Oroch foi para
// `contato.comercial@sbwebservices.net` e quem respondeu foi `camilag.santana@superbid.net`; o
// infraenergia tinha devolvido como PERMANENTE em 30/09. O bloqueio estava certo — faltava a tela
// dizer para ONDE mandar. Aqui: endereços do MESMO domínio que já nos responderam (caixa de entrada)
// ou que receberam e-mail nosso com entrega confirmada, fora da lista de supressão.
// Leitura best-effort: falha devolve [] e a mensagem de bloqueio segue sem sugestão.
const SB = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

async function ler(path) {
  const r = await fetch(`${SB()}/rest/v1/${path}`, { headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}` }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

export async function contatosAlternativos(bloqueados = []) {
  try {
    const lista = (Array.isArray(bloqueados) ? bloqueados : [bloqueados]).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
    const dominios = [...new Set(lista.map((e) => e.split('@')[1]).filter((d) => d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
    if (!dominios.length || !SB() || !KEY()) return [];
    const desde = new Date(Date.now() - 365 * 86400000).toISOString();
    const achados = new Map(); // email → motivo
    for (const d of dominios) {
      const dom = encodeURIComponent(`*@${d}`);
      const [resp, entregues] = await Promise.all([
        ler(`email_caixa?direcao=eq.entrada&de_email=ilike.${dom}&criado_em=gt.${desde}&select=de_email&order=criado_em.desc&limit=20`),
        ler(`emails_log?destinatario=ilike.${dom}&status=in.(entregue,aberto,clicado)&enviado_em=gt.${desde}&select=destinatario&order=enviado_em.desc&limit=20`),
      ]);
      for (const r of resp) { const e = String(r.de_email || '').toLowerCase(); if (e && !achados.has(e)) achados.set(e, 'já respondeu'); }
      for (const r of entregues) { const e = String(r.destinatario || '').toLowerCase(); if (e && !achados.has(e)) achados.set(e, 'recebeu e-mail nosso'); }
    }
    for (const b of lista) achados.delete(b);
    if (!achados.size) return [];
    const emails = [...achados.keys()];
    const sup = await ler(`emails_supressao?suprimido=eq.true&destinatario=in.(${emails.map((e) => `"${e}"`).join(',')})&select=destinatario`);
    const bloqueadosTambem = new Set(sup.map((s) => String(s.destinatario).toLowerCase()));
    return emails.filter((e) => !bloqueadosTambem.has(e)).slice(0, 3).map((email) => ({ email, motivo: achados.get(email) }));
  } catch (e) {
    console.warn('[contatos-alternativos] sem sugestão:', e?.message || e);
    return [];
  }
}

/** Mensagem de bloqueio com as sugestões, pronta para a tela. */
export function mensagemBloqueio(sugestoes) {
  const base = 'Este e-mail do leiloeiro já devolveu mensagem antes (endereço inexistente ou caixa bloqueada), então não reenviamos para ele.';
  if (!sugestoes?.length) return `${base} Remova-o, confirme o contato correto no site/edital do leiloeiro e envie de novo.`;
  return `${base} Contatos deste leiloeiro que funcionam: ${sugestoes.map((s) => `${s.email} (${s.motivo})`).join(', ')}. Troque o endereço e envie de novo.`;
}
