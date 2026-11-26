/**
 * Agenda de leilões dos assessorados (26/11, pedido do dono) — fonte ÚNICA para a tela
 * (/assessorados → calendário) e para o lembrete por e-mail (api/leiloes-agenda-cron.js).
 * As duas leem daqui para não poderem divergir: o que aparece no calendário é exatamente o que
 * gera aviso na véspera e no dia.
 *
 * O que entra na agenda:
 *   - oportunidade SELECIONADA pela equipe e APROVADA pelo cliente (oportunidades_selecionadas,
 *     status 'aprovada'). Só depois do "aprovo" do cliente — a seleção pendente não é compromisso.
 *   - caso CONTRATADO ainda sem arremate (casos sem arrematado_em/posse_em, fora de 'concluido').
 * Cada praça com data vira um evento. Lote com resultado definido (vendido, arrematado…) sai.
 *
 * Leitura que falha LANÇA (não vira "agenda vazia"): calendário vazio tem de significar "não há
 * leilão", nunca "não consegui ler" — é a forma nº 2 do CLAUDE.md.
 */
export const TZ = 'America/Sao_Paulo';

// `data_leilao` é TEXTO com fuso ("2026-11-24T14:30:00-03:00") e `data_leilao_2` é timestamptz.
// Data sem hora chega como meia-noite UTC ("2026-10-20 00:00:00+00"): no fuso de Brasília isso
// cairia no DIA ANTERIOR às 21h. Meia-noite UTC exata = "só a data", e o dia sai da parte UTC.
export function lerDataPraca(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { iso: `${s}T12:00:00-03:00`, dia: s, horaConhecida: false };
  // O PostgREST devolve timestamptz como "2026-10-20 00:00:00+00": o "+00" sem minutos o JS não
  // lê (Date.parse → NaN) e a 2ª praça sumia da agenda calada. Normaliza para "+00:00".
  const ms = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    const dia = d.toISOString().slice(0, 10);
    return { iso: `${dia}T12:00:00-03:00`, dia, horaConhecida: false };
  }
  return { iso: d.toISOString(), dia: diaNoFuso(d), horaConhecida: true };
}

export function diaNoFuso(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Diferença em DIAS DE CALENDÁRIO (no fuso de Brasília) entre hoje e o dia do leilão.
export function diasAte(agoraMs, dia) {
  const a = Date.parse(`${diaNoFuso(new Date(agoraMs))}T00:00:00Z`);
  const b = Date.parse(`${dia}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * @param ler   (path) => Promise<array> — leitor do PostgREST que LANÇA em não-2xx.
 * @param clienteIds  restringe aos clientes (null = todos os que têm caso/aprovação).
 * @param desdeDias   quantos dias para trás manter (o calendário mostra o mês corrente inteiro).
 */
export async function montarAgenda(ler, { clienteIds = null, desdeDias = 31, agora = Date.now() } = {}) {
  if (Array.isArray(clienteIds) && !clienteIds.length) return [];
  const filtroCli = Array.isArray(clienteIds) ? `cliente_id=in.(${clienteIds.join(',')})&` : '';

  const [aprovadas, casos] = await Promise.all([
    ler(`oportunidades_selecionadas?${filtroCli}status=eq.aprovada&select=id,cliente_id,imovel_id,decidida_em`),
    ler(`casos?${filtroCli}arrematado_em=is.null&posse_em=is.null&status_etapa=neq.concluido&imovel_id=not.is.null&select=id,cliente_id,imovel_id,imovel_endereco,imovel_valor`),
  ]);

  // Um imóvel por cliente: se o mesmo lote está como caso E como aprovada, vale o caso (é o
  // registro operacional), mas a origem 'aprovada' fica marcada.
  const itens = new Map();
  for (const a of aprovadas) {
    if (!UUID.test(String(a.imovel_id))) continue;
    itens.set(`${a.cliente_id}|${a.imovel_id}`, { cliente_id: a.cliente_id, imovel_id: String(a.imovel_id), origem: 'aprovada', caso_id: null });
  }
  for (const c of casos) {
    if (!UUID.test(String(c.imovel_id))) continue;
    const k = `${c.cliente_id}|${c.imovel_id}`;
    const ja = itens.get(k);
    itens.set(k, { cliente_id: c.cliente_id, imovel_id: String(c.imovel_id), origem: ja ? 'aprovada' : 'caso', caso_id: c.id, endereco: c.imovel_endereco, valor_caso: c.imovel_valor });
  }
  if (!itens.size) return [];

  const imovelIds = [...new Set([...itens.values()].map((i) => i.imovel_id))];
  const cliIds = [...new Set([...itens.values()].map((i) => i.cliente_id))];
  const [imoveis, perfis] = await Promise.all([
    ler(`imoveis_leilao?id=in.(${imovelIds.join(',')})&select=id,titulo,cidade,estado,endereco,data_leilao,data_leilao_2,valor_avaliacao,valor_minimo,valor_minimo_2,url_lote,resultado_leilao,ativo`),
    ler(`perfis?id=in.(${cliIds.join(',')})&select=id,nome`),
  ]);
  const imv = new Map(imoveis.map((i) => [String(i.id), i]));
  const nome = new Map(perfis.map((p) => [p.id, p.nome]));
  // Resultado que ENCERRA o lote. 'sem_lance' NÃO encerra (1ª praça deserta → a 2ª ainda vem) e
  // 'indeterminado' é "o apurador não soube" — os dois continuam na agenda.
  const encerrado = (r) => ['vendido', 'cancelado'].includes(String(r || ''));

  const limite = agora - desdeDias * 86400000;
  const eventos = [];
  for (const it of itens.values()) {
    const im = imv.get(it.imovel_id);
    if (!im || encerrado(im.resultado_leilao)) continue;
    const pracas = [
      { praca: 1, data: lerDataPraca(im.data_leilao), lance: im.valor_minimo },
      { praca: 2, data: lerDataPraca(im.data_leilao_2), lance: im.valor_minimo_2 ?? im.valor_minimo },
    ].filter((p) => p.data);
    const temDuas = pracas.length > 1;
    for (const p of pracas) {
      if (Date.parse(`${p.data.dia}T23:59:59-03:00`) < limite) continue;
      eventos.push({
        chave: `${it.cliente_id}|${it.imovel_id}|${p.praca}|${p.data.dia}`,
        cliente_id: it.cliente_id,
        cliente_nome: nome.get(it.cliente_id) || 'Cliente',
        imovel_id: it.imovel_id,
        caso_id: it.caso_id,
        origem: it.origem,
        titulo: im.titulo || it.endereco || 'Imóvel',
        cidade: im.cidade || null,
        uf: im.estado || null,
        praca: temDuas ? p.praca : null,
        quando: p.data.iso,
        dia: p.data.dia,
        hora_conhecida: p.data.horaConhecida,
        lance_minimo: Number(p.lance) || Number(it.valor_caso) || null,
        avaliacao: Number(im.valor_avaliacao) > 0 ? Number(im.valor_avaliacao) : null,
        url_lote: im.url_lote || null,
        lote_ativo: im.ativo !== false,
      });
    }
  }
  eventos.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
  return eventos;
}

/**
 * Totais das operações REALIZADAS (arrematadas) — o painel global da tela de Assessorados.
 * Realizada = caso com `arrematado_em` (em andamento ou concluída).
 *   aquisição: valor declarado do arremate (arrematados.valor_arrematacao) → lance vencedor
 *              apurado → valor do caso.
 *   avaliação: imoveis_leilao.valor_avaliacao → avaliação guardada no portfólio do cliente.
 *   lucro bruto projetado = avaliação − aquisição, SÓ sobre os imóveis que têm as duas pontas.
 * Imóvel sem avaliação NÃO entra como avaliação zero (isso inventaria prejuízo): vai para
 * `sem_avaliacao` e a tela diz quantos ficaram de fora da conta do lucro.
 */
export async function totaisRealizadas(ler, { clienteIds = null } = {}) {
  if (Array.isArray(clienteIds) && !clienteIds.length) return vazio();
  const filtroCli = Array.isArray(clienteIds) ? `cliente_id=in.(${clienteIds.join(',')})&` : '';
  const casos = await ler(`casos?${filtroCli}arrematado_em=not.is.null&select=id,cliente_id,imovel_id,imovel_valor,posse_em`);
  if (!casos.length) return vazio();

  const imovelIds = [...new Set(casos.map((c) => String(c.imovel_id || '')).filter((x) => UUID.test(x)))];
  const cliIds = [...new Set(casos.map((c) => c.cliente_id))];
  const [imoveis, portfolio] = await Promise.all([
    imovelIds.length ? ler(`imoveis_leilao?id=in.(${imovelIds.join(',')})&select=id,valor_avaliacao,valor_lance_vencedor`) : [],
    ler(`arrematados?user_id=in.(${cliIds.join(',')})&select=user_id,imovel_id,valor_arrematacao,aval:imovel->>valor_avaliacao`),
  ]);
  const imv = new Map(imoveis.map((i) => [String(i.id), i]));
  const port = new Map(portfolio.map((a) => [`${a.user_id}|${a.imovel_id}`, a]));
  const num = (v) => (Number(v) > 0 ? Number(v) : null);

  const t = vazio();
  for (const c of casos) {
    const im = imv.get(String(c.imovel_id));
    const pf = port.get(`${c.cliente_id}|${c.imovel_id}`);
    const aquisicao = num(pf?.valor_arrematacao) ?? num(im?.valor_lance_vencedor) ?? num(c.imovel_valor);
    const avaliacao = num(im?.valor_avaliacao) ?? num(pf?.aval);
    t.imoveis++;
    if (c.posse_em) t.concluidas++; else t.em_andamento++;
    if (aquisicao) t.valor_aquisicao += aquisicao; else t.sem_aquisicao++;
    if (avaliacao) t.valor_avaliacao += avaliacao; else t.sem_avaliacao++;
    if (aquisicao && avaliacao) {
      t.lucro_bruto += avaliacao - aquisicao;
      t.base_lucro_aquisicao += aquisicao;
      t.base_lucro_imoveis++;
    }
  }
  return t;
}
function vazio() {
  return { imoveis: 0, em_andamento: 0, concluidas: 0, valor_avaliacao: 0, valor_aquisicao: 0, lucro_bruto: 0, base_lucro_aquisicao: 0, base_lucro_imoveis: 0, sem_avaliacao: 0, sem_aquisicao: 0 };
}
