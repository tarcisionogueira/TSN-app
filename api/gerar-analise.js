// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const REUSE_DIAS = Number(process.env.ANALISE_REUSE_DIAS || 7); // reaproveita a pesquisa de mercado deste imóvel se feita há < N dias

const brl = (v) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnalise(row) {
  // upsert por (user_id, imovel_id)
  await sb('analises_mercado?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

export function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
export function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}
// Pesquisa de mercado recente do MESMO imóvel (de qualquer usuário). Reaproveitada
// para não refazer a busca cara a cada pedido — só a data é renovada. O laudo
// (parecer) continua sendo gerado por pedido, pois depende do lance/cenário de cada um.
async function mercadoRecente(imovelId) {
  const desde = new Date(Date.now() - REUSE_DIAS * 24 * 3600 * 1000).toISOString();
  const r = await sb(`analises_mercado?imovel_id=eq.${encodeURIComponent(imovelId)}&status=eq.concluida&updated_at=gte.${desde}&select=result,updated_at&order=updated_at.desc&limit=1`);
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  return row?.result?.mercado ? { mercado: row.result.mercado, em: row.updated_at } : null;
}

async function anthropic(payload, useSearch) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) });
  return r.json();
}

export function promptMercado({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente. Compare sempre ${tipoImovel} com ${tipoImovel}.

REGRA OBRIGATÓRIA — NADA DE LEILÃO NA AMOSTRA: descarte QUALQUER anúncio de leilão, praça,
hasta pública, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou
imóvel retomado. Esses preços ficam 30–60% abaixo do mercado e CONTAMINAM a média e o mínimo
(R$/m²). Compare só com o MERCADO LIVRE de venda normal. Outlier muito abaixo dos demais, sem
justificativa, também deve ser descartado como provável leilão disfarçado.

OBJETIVO: reunir o MÁXIMO de amostras possível. Faça várias buscas em fontes diferentes.

═══ NÍVEL 1 — COMPARATIVOS DIRETOS (mesmo condomínio/endereço) ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio/edifício ou
na mesma rua. Se NÃO encontrar ao menos 5 amostras, EXPANDA o raio para ~250m ao redor
do endereço para complementar (mantendo o mesmo tipo de imóvel). Meta: 8+ vendas e 5+ locações.

═══ NÍVEL 2 — VIZINHANÇA (bairro e adjacências, ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências (~1km). Meta: 15+ vendas e 8+ locações.

FONTES: ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
O preço varia no tempo — priorize as amostras mais recentes na média.

═══ REFERÊNCIA INDEPENDENTE — ÍNDICE FipeZAP ═══
Busque o Índice FipeZAP mais recente para ${cidade}/${estado}: preço médio de VENDA por m²
(residencial), e a VALORIZAÇÃO acumulada em 12 meses da cidade. É uma referência oficial
independente da média de anúncios — serve para VALIDAR se nossa média está coerente. Se não
achar a cidade, use a região metropolitana/capital mais próxima e sinalize em "fonte". Se não
houver dado confiável, marque "encontrado": false (não invente número).

═══ ZONEAMENTO URBANO (uso do solo) ═══
Consulte o ZONEAMENTO OFICIAL do endereço no órgão municipal (Plano Diretor / Lei de Uso e Ocupação do Solo; em capitais use o GIS oficial: GeoSampa/SP, Data.Rio, IPPUC/Curitiba, BHMap/PBH etc.). Informe a ZONA e o que ela permite (residencial/comercial/misto; e gabarito/coeficiente de aproveitamento se constar) SOMENTE se achar em FONTE OFICIAL — e cite a fonte. Se NÃO houver fonte oficial confiável, marque "encontrado": false e diga exatamente ONDE obter (Secretaria de Urbanismo/Planejamento da Prefeitura, pelo endereço ou inscrição imobiliária). NUNCA invente ou especule a zona.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "descontoArremate": null },
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a ADERÊNCIA da média dos anúncios ao FipeZAP (se divergirem >15%, explique por quê)."
}`;
}

// Bloco de débitos/encargos JÁ INFORMADOS que serão assumidos (entram como CUSTO
// na viabilidade). Se constam na documentação do lote → o parecer cita; se não
// constam → cita mesmo assim e aponta ONDE buscar/confirmar (referências).
function blocoDebitos(inp, docs, brlFn) {
  const itens = [];
  if (Number(inp.debitosAssumidos) > 0) itens.push(`Débitos assumidos (gerais): R$ ${brlFn(inp.debitosAssumidos)}`);
  if (Number(inp.iptuMensal) > 0) itens.push(`IPTU: R$ ${brlFn(inp.iptuMensal)}/mês`);
  if (Number(inp.condominioMensal) > 0) itens.push(`Condomínio: R$ ${brlFn(inp.condominioMensal)}/mês`);
  if (Number(inp.laudemio) > 0) itens.push(`Laudêmio: R$ ${brlFn(inp.laudemio)}`);
  if (Number(inp.foreiro) > 0) itens.push(`Foreiro/foro: R$ ${brlFn(inp.foreiro)}`);
  if (!itens.length) return '';
  const temDocs = !!(docs && (docs.edital || docs.matricula || (Array.isArray(docs.anexos) && docs.anexos.length)));
  return `
DÉBITOS/ENCARGOS A ASSUMIR (informados — JÁ ENTRAM como custo na viabilidade acima):
${itens.map(i => '- ' + i).join('\n')}
${temDocs
  ? 'A documentação do lote está disponível (edital/matrícula/anexos). Na seção de débitos, CONFIRME se cada débito acima consta na documentação; para os que constarem, cite a fonte; para os que NÃO estiverem discriminados, sinalize e indique onde obter (referências abaixo).'
  : 'A documentação detalhada do lote NÃO foi anexada. Na seção de débitos, liste-os e — como não há documento discriminando-os — oriente claramente ONDE buscar/confirmar cada um (referências abaixo).'}
REFERÊNCIAS para confirmar/obter os valores quando não constarem na documentação:
- IPTU e taxas municipais: certidão de débitos imobiliários na Prefeitura (Secretaria da Fazenda), pelo número de inscrição/IPTU.
- Condomínio: declaração de débitos condominiais com a administradora ou o síndico.
- Ônus, hipotecas e débitos propter rem: matrícula atualizada no Cartório de Registro de Imóveis competente.
- Responsabilidade por débitos após a arrematação (quem paga o quê): cláusulas do EDITAL do leilão.
- Laudêmio/foro (terreno de marinha): SPU — Secretaria de Patrimônio da União, ou o ente foreiro.`;
}

// Foco do parecer por PERFIL-BASE do investidor (triagem no cadastro). Direciona o
// que o agente prioriza — o mesmo imóvel se defende diferente para cada perfil.
const PERFIL_FOCO = {
  revenda: 'PERFIL DO COMPRADOR: REVENDA (flip). Priorize margem, velocidade de saída e liquidez de revenda; enfatize o teto de lance que preserva o lucro na revenda.',
  locacao: 'PERFIL DO COMPRADOR: LOCAÇÃO (renda). Priorize o yield (aluguel/preço), a renda mensal líquida e o payback pela locação; o cenário de revenda é secundário.',
  uso_proprio: 'PERFIL DO COMPRADOR: USO PRÓPRIO. Priorize a economia frente ao mercado e a adequação ao uso; o piso de 30% de lucro não se aplica.',
  incorporacao: 'PERFIL DO COMPRADOR: INCORPORAÇÃO. Priorize o POTENCIAL CONSTRUTIVO (terreno, aproveitamento e zoneamento) e a viabilidade de incorporar; avalie o valor pelo potencial, não só pelo imóvel atual.',
};

function promptParecer(inp, m, mercado, docs) {
  const usoProprio = inp.objetivoCompra === 'uso_proprio';
  const debitos = blocoDebitos(inp, docs, brl);
  const focoPerfil = PERFIL_FOCO[inp._perfil] || '';
  return `
Redija um PARECER EXECUTIVO MERCADOLÓGICO E DE VIABILIDADE FINANCEIRA como Gestor Sênior da BidPro Brasil.
${focoPerfil ? `\n${focoPerfil}\n` : ''}

ESCOPO ESTRITO: foque EXCLUSIVAMENTE em mercado × valor de aquisição e viabilidade
financeira. NÃO faça análise JURÍDICA (consulta de processo/CNJ, validade de penhora,
gravames, riscos de nulidade, diligências) — isso é dos relatórios DOCUMENTAL e
JURÍDICO. EXCEÇÃO: os DÉBITOS/ENCARGOS A ASSUMIR informados abaixo DEVEM constar,
pois são CUSTO da operação e impactam a viabilidade — apenas no aspecto financeiro
(valor e onde confirmar), sem entrar no mérito jurídico.

IMÓVEL: ${inp.tipo || inp.tipoImovel} — ${inp.endereco}, ${inp.cidade || ''}/${inp.estado || ''}
OBJETIVO: ${usoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}
${inp.nomeCondominio ? `CONDOMÍNIO: ${inp.nomeCondominio}` : ''}

MERCADO:
- Preço médio/m² (média dos anúncios): R$ ${brl(mercado?.precoMedioM2)}
- Aluguel médio: R$ ${brl(mercado?.aluguelMedio)} · Yield: ${(mercado?.yieldBruto || 0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido || 0).toFixed(2)}% líquido
${mercado?.referenciaFipeZap?.encontrado ? `- Referência FipeZAP (${mercado.referenciaFipeZap.localidade || inp.cidade || ''}, ${mercado.referenciaFipeZap.mesReferencia || 'recente'}): R$ ${brl(mercado.referenciaFipeZap.precoMedioM2)}/m² · valorização 12m: ${(Number(mercado.referenciaFipeZap.valorizacao12m) || 0).toFixed(1)}%. Compare com a média dos anúncios acima: se divergirem muito, comente e use a mais conservadora na defesa.` : ''}
${mercado?.comentario ? `- Leitura de mercado: ${mercado.comentario}` : ''}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inp.valorArrematacao)}
- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inp._teto)}
- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(m.lucro)}
- Retorno (ROI/ROE): ${(m.roi || 0).toFixed(2)}%
OBSERVAÇÕES: ${inp.observacoes || 'Sem observações adicionais'}
${debitos}

REGRA DE VIABILIDADE:
${usoProprio
  ? '- Como é USO PRÓPRIO, o piso de 30% de lucro NÃO se aplica. O foco é a ECONOMIA frente ao valor de mercado (quanto o comprador economiza ao adquirir no leilão em vez de no mercado). Defenda a aquisição pela economia e adequação ao uso.'
  : '- A operação só é VIÁVEL com no mínimo 30% de lucro líquido. Avalie SEM DISPUTA (lance base) e COM DISPUTA (até o lance máximo que ainda preserva 30%).'}

Escreva em português formal, texto simples (sem markdown/asteriscos). Estruture com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO (mercado × valor de aquisição; desconto real frente ao mercado)
§ SEÇÃO: CENÁRIOS DE LANCE (sem disputa e com disputa; até onde dá para subir o lance mantendo ${usoProprio ? 'a economia' : 'o piso de 30%'})
§ SEÇÃO: PROJEÇÃO DE RENTABILIDADE (projeção de 12 MESES considerando o pagamento em parcelas até a revenda; deixe claro que VENDER ANTES dos 12 meses AUMENTA o lucro; cite ROI/ROE, yield de locação como alternativa e payback)${debitos ? '\n§ SEÇÃO: DÉBITOS E ENCARGOS ASSUMIDOS (liste os débitos informados que entram como custo; diga se constam na documentação do lote; para os que não constarem, aponte as referências de onde obter/confirmar)' : ''}
§ SEÇÃO: DEFESA DA OPERAÇÃO (argumentos objetivos de por que ${usoProprio ? 'a compra para uso compensa' : 'o investimento compensa'})
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO

IMPORTANTE — SE NÃO HOUVER VIABILIDADE${usoProprio ? ' (economia irrelevante frente ao mercado)' : ' (lucro abaixo de 30%)'}:
seja DIRETO e CURTO. Explique objetivamente O PORQUÊ (ex.: preço de aquisição próximo do
mercado, custos elevados, margem insuficiente) e recomende NÃO avançar. Não alongue o relatório.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel, mercadoInputs, parecerInputs } = body;
  if (!imovelId || !mercadoInputs) { res.status(400).json({ error: 'imovelId e mercadoInputs obrigatórios' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir um arremate manual): grava sob o
  // CLIENTE (para o relatório pertencer a ele) e não cobra cota — atribuição
  // administrativa gratuita. Só admin/analista pode; senão ignora e usa o próprio.
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // Data do leilão (para a regra de limpeza: 15 dias após o leilão sem arrematar).
  const rawData = imovel?.dataLeilao || parecerInputs?.d?.dataLeilao || null;
  const dataLeilao = rawData && !isNaN(Date.parse(rawData)) ? new Date(rawData).toISOString() : null;
  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || null, cidade: cidade || null, estado: estado || null, imovel: imovel || null, inputs: { mercadoInputs, parecerInputs }, data_leilao: dataLeilao };

  // ── Cota NO SERVIDOR (anti-abuso do custo de IA) ────────────────────────────
  // A cota é consumida aqui (onde o custo ocorre), não mais só no cliente — que
  // podia ser burlado chamando esta API direto. Cobra apenas em análise NOVA
  // deste imóvel para este usuário; re-gerar/atualizar o mesmo imóvel não recobra
  // (espelha o "isNovo" do cliente). Falha na checagem não trava quem tem direito.
  let cota = null;
  try {
    const jaConcluida = await (await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo && !onBehalf) {
      const rc = await sb('rpc/consumir_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        const msg = cota.erro === 'limite_mensal' ? 'Limite mensal de análises atingido para o seu plano.'
          : cota.erro === 'sem_credito' ? 'Você não tem créditos de análise disponíveis.'
          : 'Cota de análises indisponível.';
        res.status(402).json({ error: msg, cota });
        return;
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null });

  try {
    // 1) Mercado — reaproveita pesquisa recente do mesmo imóvel (se houver), senão busca.
    let mercado, reaproveitado = false;
    const recente = await mercadoRecente(String(imovelId));
    if (recente) {
      mercado = { ...recente.mercado, reaproveitado: true, pesquisaEm: recente.em };
      reaproveitado = true;
    } else {
      const mData = await anthropic({
        model: MODEL, max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`,
        messages: [{ role: 'user', content: promptMercado(mercadoInputs) }],
      }, true);
      mercado = parseJSON(extractText(mData)) || {};
      mercado.precoMedioM2 = mercado.consolidado?.precoMedioM2 || mercado.nivel2?.precoMedioM2 || 0;
      mercado.aluguelMedio = mercado.consolidado?.aluguelMedio || 0;
      mercado.yieldBruto = mercado.consolidado?.yieldBruto || 0;
      mercado.yieldLiquido = mercado.consolidado?.yieldLiquido || 0;
      mercado.vendas = mercado.nivel2?.vendas || [];
      mercado.locacoes = mercado.nivel2?.locacoes || [];
      mercado.pesquisaEm = new Date().toISOString();
    }

    const areaM2 = Number(mercadoInputs.areaM2) || 0;
    const valorMercado = (mercado.precoMedioM2 && areaM2) ? Math.round(mercado.precoMedioM2 * areaM2 * 0.9) : null;
    const valorLocacao = mercado.aluguelMedio ? Math.round(mercado.aluguelMedio) : null;

    // 2) Laudo (parecer). Carrega os docs do lote para o parecer poder dizer se os
    // débitos informados já constam na documentação (ou apontar onde buscar).
    let parecer = '';
    if (parecerInputs?.d) {
      try {
        let docs = null;
        try {
          const [dRow] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=link_edital,link_matricula,link_regras_venda,anexos&limit=1`)).json();
          if (dRow) docs = { edital: dRow.link_edital, matricula: dRow.link_matricula, regras: dRow.link_regras_venda, anexos: dRow.anexos };
        } catch { /* sem docs → o parecer orienta onde buscar */ }
        // Perfil-base do investidor (triagem) — direciona o foco do parecer.
        let perfilInvestidor = null;
        try {
          const [p] = await (await sb(`perfis?id=eq.${ownerId}&select=perfil_investidor&limit=1`)).json();
          perfilInvestidor = p?.perfil_investidor || null;
        } catch { /* sem perfil → parecer padrão pelo objetivoCompra */ }
        const pInp = { ...parecerInputs.d, valorMercado: valorMercado || parecerInputs.d.valorMercado, _cenario: parecerInputs.cenario, _teto: parecerInputs.teto, _perfil: perfilInvestidor };
        // APRENDIZADO: correções que analistas fizeram em avaliações anteriores
        // (via transcrição de reunião → mercado_aprendizado) voltam ao prompt. No-op
        // enquanto não houver lições; fica mais assertivo com o uso.
        let aprendizadoMercado = '';
        try {
          const licoes = await (await sb('mercado_aprendizado?select=campo,valor_ia,valor_real,observacao&order=criado_em.desc&limit=30')).json();
          if (Array.isArray(licoes)) {
            const linhas = licoes
              .filter(l => l && (l.valor_real || l.observacao))
              .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema estimou "${String(l.valor_ia || '—').slice(0, 100)}", o analista corrigiu para "${String(l.valor_real || '—').slice(0, 100)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 160)}` : ''}`);
            if (linhas.length) aprendizadoMercado = `\n\nAPRENDIZADOS COM ANALISTAS (correções reais de avaliações anteriores — aplique estas lições e evite repetir os mesmos erros):\n${linhas.join('\n')}`;
          }
        } catch { /* aprendizado é best-effort */ }
        const pData = await anthropic({
          model: MODEL, max_tokens: 8000,
          system: 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA. Não faça análise jurídica (CNJ, gravames, diligências) — isso é de outros relatórios. EXCEÇÃO: os débitos/encargos informados que serão assumidos DEVEM constar (são custo da operação), com a indicação de onde confirmá-los. Preciso e persuasivo. Nunca use markdown nem asteriscos. Apenas texto simples.' + aprendizadoMercado,
          messages: [{ role: 'user', content: promptParecer(pInp, parecerInputs.metricas || {}, mercado, docs) }],
        }, false);
        parecer = extractText(pData);
      } catch { /* laudo é complementar */ }
    }

    // Lembrete fixo (não-IA): a análise é apoio e não substitui a verificação
    // presencial. Recomenda visitar o imóvel ou ver um similar com corretor.
    const AVISO_MERCADO = '§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise mercadológica é gerada com apoio de inteligência artificial e tem caráter informativo — pode conter imprecisões e não substitui a verificação presencial. Antes de decidir, recomendamos VISITAR o imóvel pessoalmente ou AGENDAR com um corretor de confiança para conhecer um imóvel similar na região, confirmando estado de conservação, localização e o valor praticado no mercado.';
    if (parecer) parecer += `\n\n${AVISO_MERCADO}`;

    const result = { mercado, parecer, valorMercado, valorLocacao, reaproveitado, pesquisaEm: mercado.pesquisaEm };
    await upsertAnalise({ ...base, status: 'concluida', erro: null, result });

    // Realimenta o SCORE do imóvel com o veredito REAL desta análise (valor de
    // mercado estimado + viabilidade por ROI), para o card não mostrar "boa nota"
    // num imóvel que a análise reprovou. Best-effort (não bloqueia a resposta).
    try {
      const roi = Number(parecerInputs?.metricas?.roi);
      const usoProprio = parecerInputs?.d?.objetivoCompra === 'uso_proprio';
      // Meta de viabilidade: 30% de ROI para investimento; para uso próprio a
      // régua é a economia (qualquer desconto real relevante já vale).
      const meta = usoProprio ? 0 : 30;
      const viavel = isFinite(roi) ? roi >= meta : null;
      // score_financeiro REAL (0–100) derivado do ROE/ROI da análise — substitui a
      // proxy determinística do desconto vs. avaliação da Caixa (que dava nota alta
      // a imóvel ruim). A régua (meta) vira o ponto neutro 50; abaixo dela cai,
      // acima sobe. Assim a camada Financeiro do Score fica assertiva.
      const scoreFin = isFinite(roi)
        ? Math.max(0, Math.min(100, Math.round(50 + (roi - meta) * 1.5)))
        : null;
      if (imovelId && (valorMercado || viavel != null)) {
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            ...(valorMercado ? { valor_mercado: valorMercado } : {}),
            ...(viavel != null ? { analise_viavel: viavel } : {}),
            ...(scoreFin != null ? { score_financeiro: scoreFin } : {}),
            analise_em: new Date().toISOString(),
          }),
        });
      }
    } catch { /* realimentação do score é best-effort */ }
    res.status(200).json({ ok: true, result, cota });
  } catch (e) {
    await upsertAnalise({ ...base, status: 'erro', erro: String(e?.message || e) });
    // Estorna a cota consumida (não cobra por análise que falhou; evita cobrança
    // dupla na re-tentativa, já que 'erro' não conta como concluída em isNovo).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(500).json({ error: 'Falha ao gerar a análise', detalhe: String(e?.message || e) });
  }
}
