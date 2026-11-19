/**
 * FRANCOLEILOES pela API oficial do leiloeiro (Marcelo Franco, 19/11/2026) — complementa o raspador
 * `scripts/scraper-francoleiloes.mjs`, não o substitui.
 *
 * O QUE A API DÁ e o raspador não: data/hora de abertura e encerramento de cada praça (os lotes do
 * Banco Inter saíam com `data_leilao` nula), valor de cada praça, endereço com CEP, coordenadas,
 * matrícula estruturada e situação do lote. O QUE ELA NÃO DÁ: fotos (só endpoints de UPLOAD), link
 * público do lote e PDF do edital — isso continua vindo do raspador. Por isso o upsert manda só as
 * colunas que a API sabe e nunca toca em `url_lote`, `link_foto`, `fotos`, `anexos`, `link_edital`.
 *
 * ⚠️ A credencial é a da API INTERNA da plataforma deles: dá acesso a clientes (CPF, documentos,
 * contas, PIX) e a endpoints de escrita (Create/Update/Delete). Este arquivo chama SÓ leitura de
 * leilão/lote/tabelas auxiliares — a lista `ENDPOINTS_PERMITIDOS` é a trava; qualquer outro caminho lança.
 *
 * Credenciais no painel da Vercel: FRANCO_API_CLIENT_ID · FRANCO_API_CLIENT_SECRET (o par
 * FRANCO_API_USER/PASS é só o login HTTP Basic da documentação, não usado aqui).
 *
 * GRAVAR = false → RODADA EM SECO: lê tudo, monta as linhas, cruza com o que já existe e grava o
 * relatório em `recon_dump` (origem 'franco-api'). Nada vai para `imoveis_leilao` até o mapeamento
 * ser conferido sobre dado real (forma nº 10 do CLAUDE.md).
 */
import { isCronAuthorized } from './_auth.js';

const GRAVAR = false;

const BASE = 'https://www.francoleiloes.com.br/integration/api';
const FONTE = 'FRANCOLEILOES';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ENDPOINTS_PERMITIDOS = /^\/(Authenticate|GetLeiloes|GetLeilao\/\d+|GetLotes|GetLote\/\d+|GetStatusLote|GetStatusLeilao|GetCategorias|GetEstados|GetCidades\/\d+|GetModalidades)(\?|$)/;

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// Chamada à API do leiloeiro. Erro tem 3 formas e as 3 lançam: HTTP não-2xx, corpo que não é JSON, e
// `Errors`/`Erros` preenchido DENTRO de um 200 (forma nº 1 — o envelope deles carrega o erro no corpo).
async function api(caminho, token, opts = {}) {
  if (!ENDPOINTS_PERMITIDOS.test(caminho)) throw new Error(`endpoint fora da lista de leitura: ${caminho}`);
  const r = await fetch(BASE + caminho, {
    ...opts,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${caminho.split('?')[0]} HTTP ${r.status}: ${texto.slice(0, 200)}`);
  let j; try { j = JSON.parse(texto); } catch { throw new Error(`${caminho.split('?')[0]} devolveu não-JSON: ${texto.slice(0, 120)}`); }
  const erros = j?.Errors || j?.Erros;
  if (Array.isArray(erros) && erros.length) throw new Error(`${caminho.split('?')[0]} erro no corpo: ${JSON.stringify(erros).slice(0, 200)}`);
  return j;
}

// Lista paginada até PageCount. Página que falha LANÇA (forma nº 4: null não é "acabou").
async function todasPaginas(caminho, token, qtd = 100) {
  const sep = caminho.includes('?') ? '&' : '?';
  const itens = [];
  for (let p = 1; p <= 50; p++) {
    const j = await api(`${caminho}${sep}Pagina=${p}&QTDPagina=${qtd}`, token);
    const lista = j.List || [];
    itens.push(...lista);
    if (p >= (j.PageCount || 1) || !lista.length) return { itens, total: j.RecordCount ?? itens.length };
  }
  throw new Error(`${caminho}: mais de 50 páginas — limite de segurança`);
}

async function emLotes(itens, n, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += n) out.push(...await Promise.all(itens.slice(i, i + n).map(fn)));
  return out;
}

// Datas da API vêm sem fuso ("2023-12-05T14:00:00") e "1900-01-01T00:00:00" quer dizer "não há".
const dataApi = s => {
  if (!s || /^1900-01-01/.test(s) || /^0001-01-01/.test(s)) return null;
  const iso = /[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
};
const valor = v => (typeof v === 'number' && v > 0 ? v : null);

function coordenadas(txt) {
  const m = String(txt || '').match(/(-?\d{1,2}[.,]\d+)\s*[,;x ]\s*(-?\d{1,3}[.,]\d+)/i);
  if (!m) return {};
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  // Brasil: lat −34..6, lng −74..−28. Fora disso é lixo ou ordem trocada — não grava.
  if (lat < -34 || lat > 6 || lng < -74 || lng > -28) return {};
  return { latitude: lat, longitude: lng };
}

const ENCERRADO = /vendid|arrematad|cancelad|suspens|encerrad|retirad|desert|prejudicad|sustad/i;

function montarLinha({ lote, leilao, statusLote, cidade, uf }) {
  const p1ini = dataApi(leilao.DataHoraAberturaPrimeiraPraca), p1fim = dataApi(leilao.DataHoraEncerramentoPrimeiraPraca);
  const p2ini = dataApi(leilao.DataHoraAberturaSegundaPraca), p2fim = dataApi(leilao.DataHoraEncerramentoSegundaPraca);
  const v1 = valor(lote.ValorInicialPrimeiraPraca), v2 = valor(lote.ValorInicialSegundaPraca);
  const aval = valor(lote.ValorAvaliacao);
  const agora = Date.now();
  const naSegunda = v2 && p1fim && Date.parse(p1fim) < agora;
  const minimo = (naSegunda ? v2 : v1) || v2 || null;
  const mat = Array.isArray(lote.Matriculas) && lote.Matriculas[0] ? lote.Matriculas[0] : null;
  const endereco = [lote.Lote_Endereco, lote.Lote_Numero, lote.Lote_Complemento].filter(x => x && String(x).trim()).join(', ') || null;
  const ultimoFim = p2fim || p1fim;
  const situacao = statusLote || null;
  const encerrado = (situacao && ENCERRADO.test(situacao)) || (ultimoFim && Date.parse(ultimoFim) < agora);
  return {
    fonte: FONTE,
    fonte_id: `${FONTE.toLowerCase()}_${lote.ID_Leiloes_Lote}`,
    titulo: lote.Lote || null,
    modalidade: /judicial/i.test(`${leilao.Leilao || ''} ${leilao.SubTituloLeilao || ''}`) && !/extrajudicial/i.test(leilao.Leilao || '') ? 'judicial' : 'extrajudicial',
    cidade, estado: uf,
    bairro: lote.Lote_Bairro || null,
    endereco,
    cep: lote.Lote_CEP || null,
    ...coordenadas(lote.Coordenadas),
    valor_avaliacao: aval,
    valor_minimo: minimo,
    valor_minimo_2: v2,
    desconto_percentual: aval && minimo ? Math.round((1 - minimo / aval) * 100) : null,
    data_leilao: p1ini, praca1_fim: p1fim,
    data_leilao_2: p2ini, praca2_fim: p2fim,
    numero_matricula: mat?.Numero ? String(mat.Numero) : null,
    leiloeiro: 'Franco Leilões',
    _situacao: situacao, _encerrado: !!encerrado,
    _leilao: leilao.Leilao || null,
  };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  const CID = process.env.FRANCO_API_CLIENT_ID, SEC = process.env.FRANCO_API_CLIENT_SECRET;
  if (!SUPABASE_URL || !SERVICE_KEY || !CID || !SEC) { res.status(500).json({ error: 'config ausente (FRANCO_API_CLIENT_ID/SECRET ou Supabase)' }); return; }

  const rel = { gravar: GRAVAR, inicio: new Date().toISOString(), etapas: {} };
  try {
    const auth = await api('/Authenticate', null, { method: 'POST', body: JSON.stringify({ Client_ID: CID, Client_Secret: SEC }) });
    const token = auth.token || auth.Token || auth.access_token;
    if (!token) throw new Error(`Authenticate sem token no corpo (chaves: ${Object.keys(auth).join(',')})`);
    rel.etapas.auth = 'ok';

    const [stLote, stLeilao, cats, estados] = await Promise.all([
      api('/GetStatusLote', token), api('/GetStatusLeilao', token),
      todasPaginas('/GetCategorias', token), api('/GetEstados', token),
    ]);
    const nomeStatus = Object.fromEntries((stLote.List || []).map(s => [s.ID_Leiloes_Lote_Status ?? s.ID ?? s.Id, s.Status ?? s.Descricao ?? s.Nome]));
    const nomeCat = Object.fromEntries(cats.itens.map(c => [c.ID_Categoria, c.Categoria]));
    const ufPorId = Object.fromEntries((estados.List || []).map(e => [e.ID_Estado, e.UF ?? e.Sigla ?? e.Estado]));
    rel.amostra_aux = { status_lote: stLote.List?.slice(0, 30), status_leilao: stLeilao.List?.slice(0, 30), categorias: cats.itens.slice(0, 60), estado_exemplo: estados.List?.slice(0, 2) };

    const leiloes = await todasPaginas('/GetLeiloes', token);
    const corte = Date.now() - 2 * 864e5;
    const vivos = leiloes.itens.filter(l => [l.DataHoraEncerramentoPrimeiraPraca, l.DataHoraEncerramentoSegundaPraca, l.DataHoraEncerramentoTerceiraPraca]
      .map(dataApi).some(d => d && Date.parse(d) >= corte));
    rel.etapas.leiloes = { total: leiloes.total, lidos: leiloes.itens.length, vivos: vivos.length };
    rel.amostra_leilao_lista = leiloes.itens.slice(0, 2);

    const detalhes = await emLotes(vivos, 4, l => api(`/GetLeilao/${l.ID_Leilao}`, token).then(j => ({ ...l, ...(j.Result || j.Item || {}) })));
    rel.amostra_leilao_detalhe = detalhes[0] ? { ...detalhes[0], ContasBancarias: undefined, Edital: String(detalhes[0].Edital || '').slice(0, 300) } : null;

    const lotesPorLeilao = await emLotes(detalhes, 4, async l => ({ leilao: l, lotes: (await todasPaginas(`/GetLotes?ID_Leilao=${l.ID_Leilao}`, token)).itens }));
    const listaLotes = lotesPorLeilao.flatMap(({ leilao, lotes }) => lotes.map(lote => ({ leilao, lote })));
    const ehImovel = ({ lote }) => /im[óo]v|apart|casa|terren|sala|galp|loja|rural|fazend|lote|pr[ée]dio/i.test(`${nomeCat[lote.ID_CategoriaPai] || ''} ${nomeCat[lote.ID_Categoria] || ''}`);
    const imoveis = listaLotes.filter(ehImovel);
    rel.etapas.lotes = { total: listaLotes.length, imoveis: imoveis.length,
      categorias_vistas: [...new Set(listaLotes.map(({ lote }) => `${nomeCat[lote.ID_CategoriaPai] || lote.ID_CategoriaPai} > ${nomeCat[lote.ID_Categoria] || lote.ID_Categoria}`))] };

    const completos = await emLotes(imoveis, 4, async ({ leilao, lote }) => {
      const j = await api(`/GetLote/${lote.ID_Leiloes_Lote}`, token);
      return { leilao, lote: { ...lote, ...(j.Item || j.Result || {}) } };
    });
    rel.amostra_lote_detalhe = completos[0] ? { ...completos[0].lote, ContasBancarias: undefined, ComitentesLote: undefined, Descricao: String(completos[0].lote.Descricao || '').slice(0, 400), Edital: String(completos[0].lote.Edital || '').slice(0, 300) } : null;

    // Cidade: GetCidades por estado, só dos estados que aparecem (cache por execução).
    const idsUf = [...new Set(completos.map(c => c.lote.Lote_ID_Estado).filter(Boolean))];
    const cidadesPorUf = {};
    for (const id of idsUf) {
      const j = await api(`/GetCidades/${id}`, token);
      cidadesPorUf[id] = Object.fromEntries((j.List || []).map(c => [c.ID_Cidade, c.Cidade ?? c.Nome]));
    }

    const linhas = completos.map(({ leilao, lote }) => montarLinha({
      lote, leilao,
      statusLote: nomeStatus[lote.ID_Leiloes_Lote_Status] || null,
      cidade: cidadesPorUf[lote.Lote_ID_Estado]?.[lote.Lote_ID_Cidade] || null,
      uf: ufPorId[lote.Lote_ID_Estado] || null,
    }));

    // Cruzamento com o que o raspador já gravou.
    const r = await sb(`imoveis_leilao?fonte=eq.${FONTE}&select=fonte_id,ativo,valor_minimo,data_leilao,cidade,url_lote`);
    if (!r.ok) throw new Error(`leitura do acervo HTTP ${r.status}`);
    const existentes = Object.fromEntries((await r.json()).map(x => [x.fonte_id, x]));
    const abertos = linhas.filter(l => !l._encerrado);
    rel.cruzamento = {
      linhas: linhas.length, abertos: abertos.length, encerrados: linhas.length - abertos.length,
      ja_no_acervo: linhas.filter(l => existentes[l.fonte_id]).length,
      abertos_novos: abertos.filter(l => !existentes[l.fonte_id]).length,
      ativos_no_acervo_ausentes_da_api: Object.values(existentes).filter(x => x.ativo && !linhas.some(l => l.fonte_id === x.fonte_id)).map(x => x.fonte_id),
      preenchimento: Object.fromEntries(['cidade', 'estado', 'endereco', 'cep', 'latitude', 'valor_avaliacao', 'valor_minimo', 'data_leilao', 'praca1_fim', 'praca2_fim', 'numero_matricula']
        .map(k => [k, abertos.filter(l => l[k] != null && l[k] !== '').length])),
      situacoes: abertos.reduce((a, l) => (a[l._situacao || '(sem)'] = (a[l._situacao || '(sem)'] || 0) + 1, a), {}),
    };
    rel.amostra_linhas = abertos.slice(0, 5).map(l => ({ ...l, _no_acervo: existentes[l.fonte_id] || null }));

    if (GRAVAR) {
      // (ligado só depois da rodada em seco conferida)
    }
    rel.fim = new Date().toISOString();
  } catch (e) {
    rel.erro = String(e.message || e).slice(0, 500);
  }

  const w = await sb('recon_dump', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ origem: 'franco-api', chave: GRAVAR ? 'rodada' : 'seco', conteudo: rel }) });
  if (!w.ok) rel.recon_dump_falhou = `HTTP ${w.status}`;
  res.status(rel.erro ? 502 : 200).json({ ok: !rel.erro, erro: rel.erro || null, etapas: rel.etapas, cruzamento: rel.cruzamento || null });
}
