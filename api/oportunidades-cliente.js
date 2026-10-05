/**
 * GET /api/oportunidades-cliente?cliente_id=<uuid>
 *
 * Oportunidades para um assessorado que CONTRATOU e ainda não arrematou (pedido do dono, 02/10:
 * "direcionar com o máximo de brevidade e garantir a arrematação dele"). Abre na tela
 * Assessorados, seção "Contratadas".
 *
 * NÃO é uma régua nova: é a do e-mail de oportunidades aplicada a um cliente só.
 *   · tipos + desconto mínimo pela intenção → ajustarFiltrosPorIntencao (a MESMA da Busca);
 *   · teto pela faixa de capital → TETO_FAIXA (./_curadoria.js, o mesmo do cron);
 *   · ordem e "por que este imóvel" → pontuarCandidato (./_curadoria.js).
 * Centro da busca: cidades de interesse da triagem, senão a cidade do cadastro; raio em escada
 * (25 → 50 → 100 → 200 km) até juntar candidatos suficientes.
 *
 * Vazio NUNCA sai mudo: sem triagem, sem cidade localizável ou sem lote que caiba, a resposta
 * diz qual dos três (`aviso`) e devolve os critérios usados, para a equipe ajustar com o cliente.
 *
 * Acesso: admin, ou membro da equipe DESIGNADO ao cliente (assessorado_designacao) — a mesma
 * cerca de /api/admin-assessorados.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { logAtividade } from './_atividade.js';
import MUNICIPIOS from './_municipios.js';
import { encerradoPorDatas } from './_leilao-encerrado.js';
import { ajustarFiltrosPorIntencao } from '../src/lib/intencao.js';
import { TIPOS_POR_PERFIL, TETO_FAIXA, PERFIL_ROTULO, FAIXA_ROTULO, pontuarCandidato, resumoComportamento, distanciaKm } from './_curadoria.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ROLES_EQUIPE = ['analista', 'advogado', 'consultor'];
const RAIOS = [25000, 50000, 100000, 200000];
const ALVO_CANDIDATOS = 40;
const SEL = 'id,titulo,endereco,cidade,estado,tipo,modalidade,valor_minimo,valor_minimo_ref,valor_avaliacao,desconto_percentual,data_leilao,data_leilao_2,data_fim,praca1_fim,praca2_fim,link_foto,fonte,latitude,longitude,score_financeiro,score_localizacao,ocupacao,forma_pagamento';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const RE_UUID = /^[0-9a-f-]{36}$/i;
const norm = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function centroide(cidade, uf) {
  if (!cidade || !uf) return null;
  const c = MUNICIPIOS[`${String(uf).toUpperCase()}|${norm(cidade)}`];
  return Array.isArray(c) ? { lat: c[0], lng: c[1], rotulo: `${cidade}/${String(uf).toUpperCase()}` } : null;
}

// Leitura que LANÇA em não-2xx: "não consegui ler" não pode virar "não há oportunidade" (forma 2).
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`consulta ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
async function rpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`rpc ${fn} HTTP ${r.status}`);
  return r.json();
}

// A data que importa para a equipe é a PRÓXIMA praça, não a 1ª (02/10, print do dono: lotes com
// 1ª praça em 22/09 e 2ª ainda por vir apareciam como "22/09/2026" — parecia leilão passado).
function proximaPraca(im) {
  const agora = Date.now();
  const pracas = [[im.data_leilao, '1ª praça'], [im.data_leilao_2, '2ª praça']]
    .map(([d, rot]) => ({ t: Date.parse(d || ''), d, rot })).filter((x) => Number.isFinite(x.t));
  const futura = pracas.filter((x) => x.t >= agora - 12 * 3600e3).sort((a, b) => a.t - b.t)[0];
  if (futura) return { dataLeilao: futura.d, praca: pracas.length > 1 ? futura.rot : null };
  return { dataLeilao: im.data_fim || null, praca: im.data_fim ? 'encerra' : null };
}

// Mesma cerca para os dois métodos: admin, ou equipe DESIGNADA ao cliente.
async function autorizar(req, clienteId) {
  const user = await getUser(req);
  if (!user) return { erro: unauthorized() };
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && !ROLES_EQUIPE.includes(role)) return { erro: forbidden('Sem permissão') };
  if (!RE_UUID.test(clienteId || '')) return { erro: json({ error: 'cliente_id inválido' }, 400) };
  if (role !== 'admin') {
    const d = await sbGet(`assessorado_designacao?cliente_id=eq.${clienteId}&membro_id=eq.${user.id}&select=cliente_id&limit=1`);
    if (!d.length) return { erro: forbidden('Este cliente não está designado a você') };
  }
  return { user };
}

// POST { cliente_id, imovel_id, titulo } — a equipe ABRIU um lote da lista: entra na linha do
// tempo do cliente (Cliente 360), para se saber o que já foi olhado/oferecido a ele.
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'corpo inválido' }, 400); }
  try {
    const a = await autorizar(req, body.cliente_id);
    if (a.erro) return a.erro;
    if (!RE_UUID.test(String(body.imovel_id || ''))) return json({ error: 'imovel_id inválido' }, 400);
    await logAtividade(body.cliente_id, 'equipe_abriu_oportunidade',
      `Equipe abriu oportunidade: ${String(body.titulo || body.imovel_id).slice(0, 140)}`,
      { imovel_id: body.imovel_id }, a.user.id);
    return json({ ok: true });
  } catch (e) {
    console.error('[oportunidades-cliente] registrar abertura', e.message);
    return json({ error: 'não registrado' }, 502);
  }
}

export const GET = handler;
async function handler(req) {
  const clienteId = new URL(req.url, 'http://localhost').searchParams.get('cliente_id') || '';
  try {
    const a = await autorizar(req, clienteId);
    if (a.erro) return a.erro;
    const user = a.user;
    const [perfil] = await sbGet(`perfis?id=eq.${clienteId}&select=id,nome,perfil_investidor,faixa_capital,forma_pagamento,endereco_cidade,endereco_uf,cidades_interesse,triagem_em&limit=1`);
    if (!perfil) return json({ error: 'Cliente não encontrado' }, 404);

    const perfilInv = perfil.perfil_investidor || null;
    const tetoFaixa = TETO_FAIXA[perfil.faixa_capital] || 0;
    const aj = ajustarFiltrosPorIntencao(perfilInv, TIPOS_POR_PERFIL[perfilInv] || [], 0);
    const tipos = aj.tipos;
    const descontoMin = aj.descontoMin;

    // Centros: cidades de interesse (até 3), senão a cidade do cadastro.
    const interesse = (Array.isArray(perfil.cidades_interesse) ? perfil.cidades_interesse : [])
      .map((c) => (c && typeof c === 'object' ? centroide(c.cidade, c.uf) : null)).filter(Boolean).slice(0, 3);
    const centros = interesse.length ? interesse : [centroide(perfil.endereco_cidade, perfil.endereco_uf)].filter(Boolean);

    const criterios = {
      perfil: perfilInv ? (PERFIL_ROTULO[perfilInv] || perfilInv) : null,
      faixa: perfil.faixa_capital ? (FAIXA_ROTULO[perfil.faixa_capital] || perfil.faixa_capital) : null,
      pagamento: perfil.forma_pagamento || null,
      teto: tetoFaixa || null,
      descontoMin: descontoMin || 0,
      tipos,
      centros: centros.map((c) => c.rotulo),
      raioKm: null,
    };
    if (!perfilInv && !perfil.faixa_capital) {
      return json({ cliente: { id: perfil.id, nome: perfil.nome }, criterios, oportunidades: [], aviso: 'O cliente ainda não respondeu a triagem de perfil (intenção e faixa de capital). Peça para ele preencher em Perfil — sem isso a busca seria genérica.' });
    }
    if (!centros.length) {
      return json({ cliente: { id: perfil.id, nome: perfil.nome }, criterios, oportunidades: [], aviso: `Não localizei a cidade do cliente (${perfil.endereco_cidade || 'vazia'}/${perfil.endereco_uf || '—'}). Ajuste a cidade de interesse no Perfil dele.` });
    }

    // Já arrematou / sinalizou sem interesse: fora da lista.
    const [arrem, semInteresse, vistosEv] = await Promise.all([
      sbGet(`arrematacoes?arrematante_id=eq.${clienteId}&select=imovel_id`),
      sbGet(`feedback_imovel?user_id=eq.${clienteId}&sinal=eq.sem_interesse&select=imovel_id`),
      sbGet(`eventos_atividade?user_id=eq.${clienteId}&tipo=eq.pageview&rota=like./imovel/*&criado_em=gte.${new Date(Date.now() - 60 * 864e5).toISOString()}&select=rota&limit=500`),
    ]);
    const excluir = new Set([...arrem, ...semInteresse].map((x) => String(x.imovel_id)));

    const achados = new Map();
    let raioUsado = null;
    for (const raio of RAIOS) {
      for (const c of centros) {
        const linhas = await rpc('buscar_por_raio_v2', {
          lat: c.lat, lng: c.lng, raio_metros: raio, lim: 120,
          tipos_filtro: tipos, desconto_min: descontoMin,
          ...(tetoFaixa ? { valor_max: tetoFaixa } : {}),
        });
        for (const im of Array.isArray(linhas) ? linhas : []) {
          if (!im?.id || excluir.has(String(im.id))) continue;
          if (!achados.has(im.id)) achados.set(im.id, im);
        }
      }
      raioUsado = raio;
      if (achados.size >= ALVO_CANDIDATOS) break;
    }
    criterios.raioKm = raioUsado ? raioUsado / 1000 : null;

    // O que o cliente abriu no site (60 dias) entra na pontuação, como no e-mail.
    const vistosIds = [...new Set(vistosEv.map((e) => String(e.rota || '').split('/')[2]).filter((x) => RE_UUID.test(x || '')))].slice(0, 100);
    const vistos = vistosIds.length ? await sbGet(`imoveis_leilao?id=in.(${vistosIds.join(',')})&select=tipo,cidade,valor_minimo_ref,valor_minimo`) : [];
    const ctxBase = { perfil_investidor: perfilInv, faixa_capital: perfil.faixa_capital, forma_pagamento: perfil.forma_pagamento, tetoPerfil: tetoFaixa || null, comportamento: resumoComportamento(vistos) };

    const ids = [...achados.keys()];
    // Datas completas só aqui (o retorno da RPC não traz todas): o lote com praça já encerrada sai.
    const completos = (ids.length ? await sbGet(`imoveis_leilao?id=in.(${ids.join(',')})&ativo=eq.true&select=${SEL}`) : [])
      .filter((im) => !encerradoPorDatas(im).encerrado);
    const oportunidades = completos.map((im) => {
      const pos = im.latitude != null ? { lat: Number(im.latitude), lng: Number(im.longitude) } : null;
      // Pontua a partir do centro MAIS PRÓXIMO do lote (cliente com várias cidades de interesse).
      const dists = centros.map((c) => ({ c, d: distanciaKm(c, pos) })).filter((x) => x.d != null).sort((a, b) => a.d - b.d);
      const centro = dists[0]?.c || centros[0];
      const { pontos, motivos } = pontuarCandidato(im, { ...ctxBase, centro });
      return {
        id: im.id, titulo: im.titulo, cidade: im.cidade, estado: im.estado, tipo: im.tipo, modalidade: im.modalidade,
        valor: Number(im.valor_minimo_ref ?? im.valor_minimo) || null, avaliacao: Number(im.valor_avaliacao) || null,
        desconto: Number(im.desconto_percentual) || null, ...proximaPraca(im),
        foto: im.link_foto || null, ocupacao: im.ocupacao || null, pagamento: im.forma_pagamento || null,
        distanciaKm: dists[0] ? Math.round(dists[0].d) : null, pontos, motivos: motivos.slice(0, 3),
      };
    // TODOS os que cabem (05/10, dono: o corte em 15 escondia 33 de 48). Ordem = encaixe.
    }).sort((a, b) => b.pontos - a.pontos);

    // Cliente 360 (02/10, dono): a busca fica na linha do tempo DO CLIENTE, com a equipe como
    // autora — a navegação de quem buscou já cai no 360 dela, mas no do cliente não aparecia nada.
    await logAtividade(clienteId, 'equipe_oportunidades',
      `Equipe buscou oportunidades no perfil: ${oportunidades.length} de ${achados.size} lote(s), até ${criterios.raioKm ?? '—'} km`,
      { criterios, top: oportunidades.slice(0, 5).map((o) => ({ id: o.id, titulo: o.titulo, valor: o.valor, desconto: o.desconto })) },
      user.id);

    return json({
      cliente: { id: perfil.id, nome: perfil.nome },
      criterios, oportunidades, totalCandidatos: oportunidades.length,
      aviso: oportunidades.length ? null
        : `Nenhum lote ativo cabe no perfil até ${criterios.raioKm} km (${tipos.join('/') || 'qualquer tipo'}, desconto ≥ ${descontoMin}%, até ${tetoFaixa ? `R$ ${tetoFaixa.toLocaleString('pt-BR')}` : 'sem teto'}). Vale revisar a faixa de capital ou as cidades com o cliente.`,
    });
  } catch (e) {
    console.error('[oportunidades-cliente]', e.message);
    return json({ error: 'Não foi possível buscar as oportunidades agora. Tente de novo em instantes.' }, 502);
  }
}
