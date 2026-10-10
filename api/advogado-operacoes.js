/**
 * GET /api/advogado-operacoes — as operações em que o advogado atua (10/10, pedido do dono).
 *
 * "Ao se cadastrar e for atribuído à operação, deve aparecer para ele a situação dos pagamentos e
 * da operação, e dar acesso aos anexos do lote." Para cada arrematação do advogado (vinculado
 * na arrematação OU no caso):
 *   · operação: cliente, imóvel, valor arrematado, etapa do caso, posse, cronograma das parcelas;
 *   · honorário: COBRADO × RECEBIDO (bruto e líquido, por recebimento — cheques com banco/nº e
 *     com quem estão) e a linha DELE do repasse, pela MESMA conta que credita
 *     (honorario_liquidar em seco — a tela nunca discorda do crédito);
 *   · anexos do lote, com link assinado curto (bucket privado).
 * Só a linha do próprio advogado sai do rateio — a fatia de terceiros não é dele para ver.
 * Admin pode consultar qualquer advogado com ?advogado_id=.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { liquidarHonorario } from './_honorario-liquidacao.js';
import { urlDocumento } from './_storage.js';
import { cronograma, proximaPendente } from '../src/utils/parcelamentoArremate.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const UUID = /^[0-9a-f-]{36}$/i;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
async function db(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
// Leitura que lança: lista vazia por erro viraria "nenhuma operação" com cara de resposta.
async function ler(path) {
  const r = await db(path);
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.data;
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  try {
    const [perfil] = await ler(`perfis?id=eq.${user.id}&select=role`);
    const pedido = new URL(req.url).searchParams.get('advogado_id');
    let advId = user.id;
    if (perfil?.role === 'admin' && UUID.test(String(pedido || ''))) advId = pedido;
    else if (perfil?.role !== 'advogado' && perfil?.role !== 'admin') return json({ error: 'Apenas advogados.' }, 403);

    const casos = await ler(`casos?advogado_id=eq.${advId}&select=id,cliente_id,imovel_id,imovel_endereco,status_etapa,posse_em,arrematado_em`);
    const idsCaso = casos.map((c) => c.id);
    const filtro = idsCaso.length ? `or=(advogado_id.eq.${advId},caso_id.in.(${idsCaso.join(',')}))` : `advogado_id=eq.${advId}`;
    const arrs = await ler(`arrematacoes?${filtro}&select=id,caso_id,imovel_id,arrematante_id,advogado_id,analista_id,valor_arrematado,honorarios_valor,honorarios_status,honorarios_pago_em,status,tipo_leilao,numero_processo,criado_em&order=criado_em.desc`);

    const operacoes = [];
    for (const a of arrs) {
      const caso = casos.find((c) => c.id === a.caso_id) || null;
      const [cli] = a.arrematante_id ? await ler(`perfis?id=eq.${a.arrematante_id}&select=nome`) : [];
      const [imovel] = UUID.test(String(a.imovel_id || '')) ? await ler(`imoveis_leilao?id=eq.${a.imovel_id}&select=titulo,endereco,cidade,estado,url_lote`) : [];
      const recs = await ler(`honorarios_recebimentos?arrematacao_id=eq.${a.id}&select=metodo,valor,valor_liquido,liquido_compensado,status,em_poder,compensado_em,banco,numero_cheque,criado_em&order=criado_em.asc`);

      // A linha DELE, pela mesma conta que credita (seco). Arrematação sem advogado gravado mas com
      // ele no caso: projeta como se estivesse vinculado (é o que vai valer quando o admin vincular).
      let repasse = null, aviso = null;
      try {
        const ap = await liquidarHonorario(db, { ...a, advogado_id: a.advogado_id || advId }, { seco: true });
        const linha = (ap.linhas || []).find((l) => l.papel === 'advogado' && l.id === advId) || null;
        repasse = {
          base_liquida: ap.base_liquida, falta_compensar: ap.falta_compensar, liquido_desconhecido: ap.liquido_desconhecido,
          pct: linha?.pct ?? null, cota: linha?.cota ?? 0, com_voce: linha?.em_poder ?? 0, creditado: linha?.creditado ?? 0, a_receber: linha?.devido ?? 0,
          projecao: !a.advogado_id,
        };
      } catch (e) { aviso = `Não foi possível apurar o repasse agora (${String(e?.message || e).slice(0, 120)}).`; }

      // Parcelas do arremate (o cliente paga ao juízo/credor) — mesmo cronograma do cliente.
      let parcelas = null;
      if (a.arrematante_id) {
        const arrd = (await ler(`arrematados?user_id=eq.${a.arrematante_id}&select=imovel_id,valor_arrematacao,data_arrematacao,parcelamento`))
          .find((x) => x.imovel_id === a.imovel_id && x.parcelamento);
        if (arrd) {
          try {
            const itens = cronograma(arrd.parcelamento, { valor: arrd.valor_arrematacao, dataArrematacao: arrd.data_arrematacao });
            parcelas = { itens, proxima: proximaPendente(itens) };
          } catch (e) { aviso = (aviso ? `${aviso} ` : '') + `Cronograma de parcelas ilegível (${e?.message}).`; }
        }
      }

      const anexosBrutos = UUID.test(String(a.imovel_id || ''))
        ? await ler(`imovel_anexos?or=(imovel_id.eq.${a.imovel_id},arrematacao_id.eq.${a.id})&select=id,tipo,nome,storage_path,url,criado_em&order=criado_em.desc&limit=60`)
        : await ler(`imovel_anexos?arrematacao_id=eq.${a.id}&select=id,tipo,nome,storage_path,url,criado_em&order=criado_em.desc&limit=60`);
      const anexos = [];
      for (const x of anexosBrutos) {
        const link = await urlDocumento(x, 3600);
        if (link) anexos.push({ id: x.id, tipo: x.tipo, nome: decodeURIComponent(String(x.nome || '').replace(/\+/g, ' ')), criado_em: x.criado_em, url: link });
      }

      operacoes.push({
        id: a.id, cliente: cli?.nome || null, imovel: imovel?.titulo || caso?.imovel_endereco || null,
        endereco: [imovel?.endereco, imovel?.cidade, imovel?.estado].filter(Boolean).join(', ') || caso?.imovel_endereco || null,
        url_lote: imovel?.url_lote || null, processo: a.numero_processo || null, tipo_leilao: a.tipo_leilao,
        valor_arrematado: a.valor_arrematado, status: a.status, etapa: caso?.status_etapa || null, posse_em: caso?.posse_em || null,
        honorario: { cobrado: a.honorarios_valor, status: a.honorarios_status, pago_em: a.honorarios_pago_em,
          recebido_bruto: recs.filter((r) => r.status === 'confirmado').reduce((s, r) => s + Number(r.valor || 0), 0),
          recebimentos: recs },
        repasse, parcelas, anexos, aviso,
      });
    }
    return json({ ok: true, operacoes });
  } catch (e) {
    console.error('[advogado-operacoes]', e?.message);
    return json({ error: 'Não foi possível carregar as operações agora.' }, 500);
  }
}
