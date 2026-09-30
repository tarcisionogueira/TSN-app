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
// Cópia nossa da capa (24/09): só existe para lote que está em relatório/caso/arremate de
// cliente (api/espelhar-docs-cron.js). Path fixo por id — entra como ÚLTIMO candidato, então
// só é pedida quando o CDN do leiloeiro já falhou; 404 aqui cai no placeholder como antes.
const SB_PUBLICO = `${import.meta.env?.VITE_SUPABASE_URL || 'https://zuwfiwokkdytvjixiwac.supabase.co'}/storage/v1/object/public/imoveis-fotos/espelho`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PESO DA FOTO (30/09, dono: "deixar o carregamento das fotos mais leve na busca"). Medido numa
// amostra de 81 fotos: Zuk/Mega/Biasi 11–17 KB, Caixa 55 KB, Superbid/GoCache ~130–160 KB — e três
// CDNs que servem a foto original para um card de ~400 px: Suporte Leilões (~300 KB, até 1 MB),
// Leilotech (~290 KB) e Alberto Macedo (~1,4 MB). Nessas, a 1ª tentativa é a MINIATURA pelo
// nosso proxy (WebP 480 px, cacheada na CDN); o original direto fica de reserva.
const HOSTS_PESADOS = /^https:\/\/(?:static\.suporteleiloes\.com\.br|cdn\.leilotech\.workers\.dev|api\.albertomacedoleiloes\.com\.br)\//i;
// Hotlink protegido por Referer (mesma lista de api/_foto-hotlink.js): o acesso direto SEMPRE
// falha (403) — ir direto ao proxy poupa uma requisição perdida por foto.
const HOTLINK_PROTEGIDO = /^https:\/\/s3-sa-east-1\.amazonaws\.com\/cdnhp\//i;
const proxy = (url, w) => `/api/img-proxy?url=${encodeURIComponent(url)}${w ? `&w=${w}` : ''}`;

export function fotoCandidatos({ foto, fonte, fonteId, imovelId, largura = 480 }) {
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
  const externa = foto && /^https?:\/\//.test(foto);
  if (externa && (HOSTS_PESADOS.test(foto) || HOTLINK_PROTEGIDO.test(foto))) cands.push(proxy(foto, largura)); // 0) miniatura
  if (externa && !HOTLINK_PROTEGIDO.test(foto)) cands.push(foto);          // 1) hotlink direto (o link_foto real)
  if (caixaUrl) cands.push(caixaUrl);                                       // 2) padrão de foto da Caixa por id
  if (!isCef && externa) cands.push(proxy(foto));                           // 3) proxy (original)
  if (!isCef && imovelId && UUID_RE.test(String(imovelId))) cands.push(`${SB_PUBLICO}/${imovelId}.jpg`); // 4) nossa cópia
  return cands;
}
