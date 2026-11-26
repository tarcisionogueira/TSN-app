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
 * Totais das operações REALIZADAS — o painel global da tela de Assessorados.
 * Devolve { imoveis, veiculos }, cada um com a mesma forma (ver `vazio`).
 *
 * LUCRO BRUTO PROJETADO = VALOR DE MERCADO − AQUISIÇÃO (26/11, dono: "traga a economia em
 * relação ao valor de mercado e não de avaliação do leiloeiro, pois ela muitas vezes é
 * incorreta"). A avaliação do leiloeiro continua no painel como referência, fora da conta.
 *
 * IMÓVEIS — caso de assessoria com `arrematado_em` + (só no escopo do admin) as operações
 * PRÓPRIAS dos administradores em "Meus arrematados" (o que já é caso não conta duas vezes).
 *   aquisição: valor do arremate (arrematados.valor_arrematacao) → lance vencedor → valor do caso.
 *   mercado:   relatório mercadológico (relatorios.dados.valorMercado → analises_mercado.result
 *              .valorMercado, o mais recente) → valor de VENDA realizada (revenda_valor: preço que
 *              o mercado pagou) → acervo (imoveis_leilao.valor_mercado) → avaliação do leiloeiro,
 *              só como último recurso e CONTADA em `mercado_pela_avaliacao` para a tela avisar.
 * VEÍCULOS — veiculo_casos fora de 'cancelado' com valor de arremate.
 *   aquisição: total pago ao leiloeiro → valor do arremate.
 *   avaliação: FIPE (do caso → do lote).
 *   mercado:   média dos anúncios do relatório do veículo (analises_veiculo.result.revendaMercado
 *              .media) → FIPE, contada em `mercado_pela_avaliacao`.
 * Sem nenhuma referência NÃO vira zero (inventaria prejuízo): conta em `sem_mercado`.
 */
export async function totaisRealizadas(ler, { clienteIds = null } = {}) {
  const [imoveis, veiculos] = await Promise.all([
    totaisImoveis(ler, clienteIds),
    totaisVeiculos(ler, clienteIds),
  ]);
  return { imoveis, veiculos };
}

const num = (v) => (Number(v) > 0 ? Number(v) : null);
// Primeiro valor > 0 por chave, na ordem já ordenada (mais recente primeiro).
function primeiroPor(linhas, chave, campo) {
  const m = new Map();
  for (const l of linhas) { const v = num(l[campo]); if (v && !m.has(String(l[chave]))) m.set(String(l[chave]), v); }
  return m;
}
function somar(t, { aquisicao, avaliacao, mercado, origemMercado, concluida, propria = false }) {
  t.qtd++;
  if (propria) t.proprias++;
  if (concluida) t.concluidas++; else t.em_andamento++;
  if (aquisicao) t.valor_aquisicao += aquisicao; else t.sem_aquisicao++;
  if (avaliacao) t.valor_avaliacao += avaliacao; else t.sem_avaliacao++;
  if (!mercado) { t.sem_mercado++; return; }
  t.valor_mercado += mercado;
  if (origemMercado === 'venda') t.mercado_pela_venda++;
  if (origemMercado === 'avaliacao') t.mercado_pela_avaliacao++;
  if (aquisicao) {
    t.lucro_bruto += mercado - aquisicao;
    t.base_lucro_aquisicao += aquisicao;
    t.base_lucro_qtd++;
  }
}
function escolherMercado(candidatos) {
  for (const [origem, v] of candidatos) if (num(v)) return { mercado: num(v), origemMercado: origem };
  return { mercado: null, origemMercado: null };
}

async function totaisImoveis(ler, clienteIds) {
  const t = vazio();
  if (Array.isArray(clienteIds) && !clienteIds.length) return t;
  const escopoAdmin = !Array.isArray(clienteIds);
  const filtroCli = escopoAdmin ? '' : `cliente_id=in.(${clienteIds.join(',')})&`;
  const [casos, admins] = await Promise.all([
    ler(`casos?${filtroCli}arrematado_em=not.is.null&select=id,cliente_id,imovel_id,imovel_valor,posse_em`),
    escopoAdmin ? ler('perfis?role=eq.admin&select=id') : [],
  ]);
  const adminIds = admins.map((a) => a.id);
  const donosPortfolio = [...new Set([...casos.map((c) => c.cliente_id), ...adminIds])];
  const portfolio = donosPortfolio.length
    ? await ler(`arrematados?user_id=in.(${donosPortfolio.join(',')})&select=user_id,imovel_id,valor_arrematacao,revenda_valor,aval:imovel->>valor_avaliacao,aval2:imovel->>avaliacao`)
    : [];
  const imovelIds = [...new Set([...casos.map((c) => c.imovel_id), ...portfolio.map((p) => p.imovel_id)].map((x) => String(x || '')).filter((x) => UUID.test(x)))];
  const lista = imovelIds.join(',');
  const [imoveis, rels, analises] = imovelIds.length ? await Promise.all([
    ler(`imoveis_leilao?id=in.(${lista})&select=id,valor_avaliacao,valor_mercado,valor_lance_vencedor`),
    ler(`relatorios?imovel_id=in.(${lista})&select=imovel_id,vm:dados->>valorMercado&order=updated_at.desc`),
    ler(`analises_mercado?imovel_id=in.(${lista})&select=imovel_id,vm:result->>valorMercado&order=updated_at.desc`),
  ]) : [[], [], []];
  const imv = new Map(imoveis.map((i) => [String(i.id), i]));
  const vmRelatorio = primeiroPor(rels, 'imovel_id', 'vm');
  const vmAnalise = primeiroPor(analises, 'imovel_id', 'vm');
  const port = new Map(portfolio.filter((a) => a.imovel_id).map((a) => [`${a.user_id}|${a.imovel_id}`, a]));
  const deCaso = new Set(casos.map((c) => `${c.cliente_id}|${c.imovel_id}`));

  const item = (imovelId, pf, extraAquisicao, concluida, propria) => {
    const id = String(imovelId || '');
    const im = imv.get(id);
    const avaliacao = num(im?.valor_avaliacao) ?? num(pf?.aval) ?? num(pf?.aval2);
    // O relatório ATUAL (analises_mercado) vem antes do legado (relatorios): em 26/11 o legado do
    // terreno do Marcos dizia R$ 7,28 mi — área de terreno × R$/m² de imóvel construído — e o atual,
    // que detecta essa incoerência, recuou para a avaliação.
    let vmRel = vmAnalise.get(id) ?? vmRelatorio.get(id);
    // Mercado IGUAL à avaliação (±0,5%) = o relatório não mediu, ancorou na avaliação. Não é
    // "valor de mercado": conta como avaliação, e a tela avisa.
    if (vmRel && avaliacao && Math.abs(vmRel - avaliacao) / avaliacao < 0.005) vmRel = null;
    somar(t, {
      aquisicao: num(pf?.valor_arrematacao) ?? num(im?.valor_lance_vencedor) ?? num(extraAquisicao),
      avaliacao,
      ...escolherMercado([
        ['relatorio', vmRel],
        ['venda', pf?.revenda_valor],
        ['acervo', im?.valor_mercado],
        ['avaliacao', avaliacao],
      ]),
      concluida, propria,
    });
  };
  for (const c of casos) item(c.imovel_id, port.get(`${c.cliente_id}|${c.imovel_id}`), c.imovel_valor, !!c.posse_em, false);
  // Operações próprias dos administradores (só no escopo do admin), sem repetir o que já é caso.
  // Operação própria registrada no portfólio já foi concluída (as atuais são todas vendidas).
  const adminSet = new Set(adminIds);
  for (const a of portfolio) {
    if (!adminSet.has(a.user_id) || (a.imovel_id && deCaso.has(`${a.user_id}|${a.imovel_id}`))) continue;
    item(a.imovel_id, a, null, true, true);
  }
  return t;
}

async function totaisVeiculos(ler, clienteIds) {
  const t = vazio();
  if (Array.isArray(clienteIds) && !clienteIds.length) return t;
  const filtroCli = Array.isArray(clienteIds) ? `cliente_id=in.(${clienteIds.join(',')})&` : '';
  const casos = await ler(`veiculo_casos?${filtroCli}etapa=neq.cancelado&select=id,cliente_id,veiculo_id,valor_arremate,valor_total_pago,valor_fipe,etapa`);
  const ids = [...new Set(casos.map((c) => String(c.veiculo_id || '')).filter((x) => UUID.test(x)))];
  const [lotes, analises] = ids.length ? await Promise.all([
    ler(`veiculos_leilao?id=in.(${ids.join(',')})&select=id,valor_fipe`),
    ler(`analises_veiculo?veiculo_id=in.(${ids.join(',')})&status=eq.concluida&select=veiculo_id,vm:result->revendaMercado->>media&order=updated_at.desc`),
  ]) : [[], []];
  const fipe = new Map(lotes.map((l) => [String(l.id), num(l.valor_fipe)]));
  const vmAnuncios = primeiroPor(analises, 'veiculo_id', 'vm');
  for (const c of casos) {
    const aquisicao = num(c.valor_total_pago) ?? num(c.valor_arremate);
    if (!aquisicao) continue; // caso aberto sem arremate ainda não é operação realizada
    const id = String(c.veiculo_id || '');
    const avaliacao = num(c.valor_fipe) ?? fipe.get(id) ?? null;
    somar(t, { aquisicao, avaliacao, ...escolherMercado([['relatorio', vmAnuncios.get(id)], ['avaliacao', avaliacao]]), concluida: c.etapa === 'concluido' });
  }
  return t;
}

function vazio() {
  return { qtd: 0, proprias: 0, em_andamento: 0, concluidas: 0, valor_avaliacao: 0, valor_mercado: 0, valor_aquisicao: 0,
    lucro_bruto: 0, base_lucro_aquisicao: 0, base_lucro_qtd: 0, sem_avaliacao: 0, sem_aquisicao: 0, sem_mercado: 0,
    mercado_pela_venda: 0, mercado_pela_avaliacao: 0 };
}
