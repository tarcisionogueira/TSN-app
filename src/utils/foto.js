// Candidatos de foto de um imóvel, em ordem de preferência. ÚNICO lugar dessa
// regra — a Busca e os cards de "imóveis semelhantes" mantinham cópias que
// divergiram: a dos similares ignorava o link_foto do CEF e construía uma URL
// com sufixo "21" errado (F<id>21.jpg), quebrando a foto ("Sem foto") desde que
// o CEF passou a ter link_foto no banco.
//
// Ordem: 1) hotlink DIRETO (funciona no navegador do usuário, IP residencial);
// 2) padrão de foto da Caixa por id (fallback); 3) proxy da Vercel (para hosts
// que bloqueiam hotlink por referer — o /api/img-proxy é bloqueado por alguns,
// então vem por último). Retorna um array; o consumidor tenta o próximo no onError.
export function fotoCandidatos({ foto, fonte, fonteId }) {
  // TRAVA DE CREDIBILIDADE (GESTAOLEILOES / "Lance no Leilão"): a foto é nomeada pelo
  // idLote (<idLote>_NN.jpg). Se o prefixo do arquivo não bate com o idLote deste
  // imóvel, é foto de OUTRO lote (bug de fatiamento já corrigido na origem) → descarta
  // e mostra placeholder em vez de confundir o cliente com o imóvel errado.
  if (fonte === 'GESTAOLEILOES' && foto) {
    const idLote = String(fonteId || '').replace(/^gestao_/, '');
    const idArq = (String(foto).match(/\/(\d+)_[^/]*$/) || [])[1];
    if (idLote && idArq && idArq !== idLote) foto = null;
  }
  const isCef = fonte === 'CEF' || fonte === 'caixa';
  const caixaUrl = isCef && fonteId
    ? `https://venda-imoveis.caixa.gov.br/fotos/F${String(fonteId).replace(/^(caixa_|cef_)/, '')}21.jpg`
    : null;
  // Já hospedado por nós (supabase) ou caminho local: usa direto, sem fallback.
  if (foto && (foto.includes('supabase.co') || foto.startsWith('/'))) return [foto];
  const cands = [];
  if (foto && /^https?:\/\//.test(foto)) cands.push(foto);                 // 1) hotlink direto (o link_foto real)
  if (caixaUrl) cands.push(caixaUrl);                                       // 2) padrão de foto da Caixa por id
  if (!isCef && foto && /^https?:\/\//.test(foto)) cands.push(`/api/img-proxy?url=${encodeURIComponent(foto)}`); // 3) proxy
  return cands;
}
