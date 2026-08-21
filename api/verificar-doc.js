/**
 * POST /api/verificar-doc  { imovel_id }
 * Verifica se a MATRÍCULA de um imóvel está de fato disponível ANTES de a tela
 * mandar o cliente para o hotlink — nasceu do clique do dono em 21/08 que caiu
 * na página de erro crua do IIS da Caixa (404 real: o PDF não foi publicado).
 *
 * A resposta separa TRÊS estados, e a diferença é o ponto (pergunta de revisão
 * da casa: "este vazio é resposta, ou é falha que não sabe que falhou?"):
 *   { disponivel: true,  url, origem }   — arquivo confirmado (anexo nosso ou hotlink 200 %PDF)
 *   { disponivel: false, motivo, busca } — RESPOSTA definitiva: 404 da Caixa ou a fila de
 *                                          captura já esgotou as tentativas ('parcial')
 *   { disponivel: null,  url, busca }    — NÃO CONSEGUIMOS checar (a Caixa bloqueia IP de
 *                                          datacenter — mesmo motivo das fotos por hotlink);
 *                                          a tela abre o hotlink como hoje, com aviso
 *
 * Efeito colateral deliberado: matrícula CEF sem resposta positiva ENFILEIRA a
 * captura automática (cef_matricula_fila, GitHub Actions a cada 30 min), que tem a
 * rota alternativa de achar a matrícula DENTRO da página do imóvel (lotes judiciais
 * não têm o PDF estático). Antes, o clique na ficha não enfileirava nada — só o
 * fluxo de análise; foi assim que o 404 chegou cru ao dono.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

const ehCef = (fonte) => /caixa|cef/i.test(fonte || '');
// Espelha src/utils/documento.js (ehMatriculaValida): arquivo de verdade, não página.
const ehArquivo = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim())
  && (/\.pdf(\?|#|$)/i.test(v.trim()) || /\/storage\/v1\/object\/(sign|public)\//i.test(v))
  && !/matricula\.asp/i.test(v);

// Testa o hotlink lendo só o PRIMEIRO chunk (basta a assinatura %PDF-). Devolve:
//   'disponivel' | 'nao_publicada' (404 — resposta definitiva) | 'inconclusivo'
// 403/challenge/timeout são 'inconclusivo': a Caixa bloqueia IP de datacenter, então
// "não consegui checar" NUNCA pode virar "não existe" — quem desempata é a fila.
async function testarHotlink(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Referer: 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp',
      },
    });
  } catch { return 'inconclusivo'; }
  if (res.status === 404) { try { await res.body?.cancel(); } catch { /* ignora */ } return 'nao_publicada'; }
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignora */ } return 'inconclusivo'; }
  try {
    const reader = res.body?.getReader?.();
    if (!reader) return 'inconclusivo';
    const { value } = await reader.read();
    try { await reader.cancel(); } catch { /* ignora */ }
    const head = value ? Array.from(value.slice(0, 5)).map(b => String.fromCharCode(b)).join('') : '';
    // 200 que NÃO é PDF = challenge/interstitial do anti-bot, não resposta sobre o arquivo.
    return head === '%PDF-' ? 'disponivel' : 'inconclusivo';
  } catch { return 'inconclusivo'; }
}

// Garante a linha na fila de captura (sem clobber: 'pendente'/'processando' ficam como
// estão; 'parcial' já esgotou as tentativas e não é re-enfileirado à toa; 'ok' sem anexo
// visível — retenção limpou — volta para a fila).
async function enfileirar(imovelId, hdniip) {
  try {
    const r = await sb(`cef_matricula_fila?imovel_id=eq.${encodeURIComponent(imovelId)}&select=id,status`);
    if (!r.ok) return null;
    const [linha] = await r.json().catch(() => []);
    if (!linha) {
      await sb('cef_matricula_fila', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ imovel_id: imovelId, hdniip, status: 'pendente' }) });
      return 'acionada';
    }
    if (linha.status === 'pendente' || linha.status === 'processando') return 'em_andamento';
    if (linha.status === 'parcial') return 'esgotada';
    // 'ok' sem anexo (chegamos aqui = sem anexo) ou 'erro': tenta de novo.
    await sb(`cef_matricula_fila?id=eq.${linha.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pendente', erro: null }) });
    return 'acionada';
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!SERVICE_KEY) return json({ error: 'Servidor não configurado' }, 500);
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const imovelId = String(b?.imovel_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imovelId)) return json({ error: 'imovel_id inválido' }, 400);

  const imovelRes = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=id,fonte,estado,fonte_id,link_matricula`);
  if (!imovelRes.ok) return json({ error: 'Erro ao consultar o imóvel' }, 502);
  const [imovel] = await imovelRes.json().catch(() => []);
  if (!imovel) return json({ error: 'Imóvel não encontrado' }, 404);

  // 1) Já temos o documento no nosso Storage (capturado ou anexado)? Melhor resposta possível.
  const anexoRes = await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&tipo=eq.matricula&storage_path=not.is.null&select=id,storage_path&limit=1`);
  const [anexo] = anexoRes.ok ? await anexoRes.json().catch(() => []) : [];
  if (anexo?.storage_path) {
    try {
      const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${anexo.storage_path}`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (sign.ok) {
        const { signedURL } = await sign.json();
        if (signedURL) return json({ disponivel: true, origem: 'anexo', url: `${SUPABASE_URL}/storage/v1${signedURL}` });
      }
    } catch { /* cai para o hotlink abaixo */ }
  }

  // 2) Monta o hotlink (CEF: PDF estático padrão; demais: link_matricula quando é ARQUIVO).
  const cef = ehCef(imovel.fonte);
  const num = String(imovel.fonte_id || '').replace(/\D/g, '');
  const uf = String(imovel.estado || '').trim().toUpperCase();
  const hotlink = cef
    ? (num && uf.length === 2 ? `https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf` : null)
    : (ehArquivo(imovel.link_matricula) ? imovel.link_matricula : null);
  if (!hotlink) return json({ disponivel: false, motivo: 'sem_link', busca: null });

  // 3) Fila de captura como ORÁCULO (só CEF): 'parcial' = 4 tentativas dentro da página
  //    do imóvel sem achar — resposta definitiva sem gastar rede.
  if (cef) {
    const filaRes = await sb(`cef_matricula_fila?imovel_id=eq.${encodeURIComponent(imovelId)}&select=status`);
    const [fila] = filaRes.ok ? await filaRes.json().catch(() => []) : [];
    if (fila?.status === 'parcial') return json({ disponivel: false, motivo: 'nao_localizada', busca: 'esgotada' });
  }

  // 4) Testa o hotlink de verdade.
  const teste = await testarHotlink(hotlink);
  if (teste === 'disponivel') return json({ disponivel: true, origem: 'hotlink', url: hotlink });

  const busca = cef && num ? await enfileirar(imovelId, num) : null;
  if (teste === 'nao_publicada') return json({ disponivel: false, motivo: 'nao_publicada', busca });
  return json({ disponivel: null, url: hotlink, busca });
}
