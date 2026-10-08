/**
 * RECON (só leitura) — em que portalId moram as ofertas das lojas SBID9 e SBID21 (#152).
 * A apuração residencial consulta a offer-query com portalId=[2,15] e nunca acha essas duas
 * lojas (resultado e origem nulos até esgotar as 6 tentativas). Uma chamada por oferta com uma
 * faixa larga de portais: se a oferta voltar, o próprio JSON diz o portal e a loja.
 */
const IDS = (process.env.RECON_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FAIXA = Array.from({ length: 80 }, (_, i) => i + 1).join(',');
const H = { Accept: 'application/json', Origin: 'https://www.superbid.net', Referer: 'https://www.superbid.net/' };
for (const id of IDS) {
  for (const st of ['', 'closed', 'opened']) {
    for (const portal of [`[${FAIXA}]`, null]) {
      const url = `https://offer-query.superbid.net/offers/?${portal ? `portalId=${portal}&` : ''}locale=pt_BR${st ? `&searchType=${st}` : ''}&filter=id:${id}&pageNumber=1&pageSize=5`;
      try {
        const r = await fetch(url, { headers: H });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch { /* corpo não-JSON: mostra o começo abaixo */ }
        const ofs = j?.offers || [];
        const o = ofs[0];
        console.log(`${id} st=${st || '-'} portal=${portal ? '1..80' : 'sem'}: HTTP ${r.status} total=${j?.total ?? '?'} ${o ? `→ portalId=${JSON.stringify(o.portalId ?? o.portal?.id ?? o.portals)} store=${JSON.stringify(o.store?.id ?? o.stores)} status=${o.offerStatus?.description || o.statusId || '?'}` : (j ? '' : txt.slice(0, 120))}`);
        if (o) console.log(`   chaves: ${Object.keys(o).slice(0, 40).join(',')}`);
      } catch (e) { console.log(`${id} st=${st || '-'}: ERRO ${String(e.message).slice(0, 100)}`); }
    }
  }
}
