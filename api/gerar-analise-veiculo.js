// Análise de VEÍCULO — UM relatório só (21/09, pedido do dono: "no lugar de dois relatórios
// [...], seria apenas um relatório com base em tudo que o leiloeiro disponibilizar entre
// edital ou descrição e anexos [...]. Trazer o relatório com a FIPE atualizada e no lugar de
// uma pesquisa mercadológica aprofundada seria basicamente condições do veículo pra ter uma
// noção se é uma boa compra ou não. Veículos ideal em 65% da FIPE.").
//
// Por que não é uma cópia de api/gerar-analise.js: aqui não existe matrícula, ITBI nem
// comparáveis geocodificados (não é imóvel) — o material é só o que o PRÓPRIO leiloeiro
// publicou (edital/laudo em anexos + descrição do lote) mais a FIPE já cacheada na linha de
// `veiculos_leilao` (api/veiculo-fipe.js já busca isso quando a tela do veículo abre — aqui só
// LEMOS o que já está lá, sem nova chamada à API da FIPE, mesmo princípio de "ler o que já
// está cacheado" usado no resto do app). Uma chamada de IA só; sem CNJ, sem QSA, sem geocode.
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude, registrarCustoGeracao } from './_uso.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';

// Faixa do lance mínimo vs. FIPE — regra do dono (21/09): "veículos ideal em 65% da FIPE".
// Determinístico no SERVIDOR (a IA não calcula percentual — só interpreta o número pronto,
// mesmo princípio de calcularMetricasCenario em gerar-analise.js: servidor calcula, IA nunca
// inventa aritmética).
function faixaFipe(pct) {
  if (pct == null) return 'sem_fipe';
  if (pct <= 65) return 'otima';
  if (pct <= 85) return 'boa';
  if (pct <= 100) return 'atencao';
  return 'alta';
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnaliseVeiculo(row) {
  await sb('analises_veiculo?on_conflict=user_id,veiculo_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch { /* tenta os formatos abaixo */ }
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch { /* tenta o bruto abaixo */ } }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch { /* sem recuperação — devolve null */ } }
  return null;
}
function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const brl = (v) => (v || v === 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');

// Documentos do lote como blocos NATIVOS pro Claude (mesma técnica de gerar-analise.js —
// PDF vai como `document` base64, sem extrair texto local; imagem também pode ir como
// `image` quando o anexo aponta pra uma foto, ex. laudo escaneado como JPG). Até 5 anexos e
// 6.5 MB cada — orçamento de tempo/tokens de uma função com 1 chamada de IA só.
async function anexosParaBlocos(anexos, deadline) {
  const blocos = [];
  const urls = (Array.isArray(anexos) ? anexos : [])
    .map((a) => (typeof a === 'string' ? a : a?.url))
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 5);
  for (const url of urls) {
    if (Date.now() > deadline) break;
    try {
      const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!buf?.length || buf.length > 6_500_000) continue;
      const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
      const ehImagem = /^image\//i.test(ct);
      if (ehPdf) {
        blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: 'documento do lote' });
      } else if (ehImagem) {
        blocos.push({ type: 'image', source: { type: 'base64', media_type: ct.split(';')[0], data: buf.toString('base64') } });
      }
    } catch { /* anexo indisponível — segue com os demais, nunca bloqueia o relatório */ }
  }
  return blocos;
}

function promptVeiculo(v, percentualFipe, faixa) {
  const sinais = [
    v.sinistro && `Sinistro (classificação do leiloeiro): ${v.sinistro}`,
    v.is_sucata && 'Vendido como SUCATA — só certificado de baixa, SEM ATPV-e (transferência não é a padrão)',
    v.motor_alerta && 'Leiloeiro menciona dano no MOTOR na descrição',
    v.financiavel === false && 'NÃO aceita financiamento — só à vista',
    v.financiavel === true && 'Aceita financiamento',
    v.ipva_situacao && `IPVA: ${v.ipva_situacao}`,
  ].filter(Boolean).join('\n- ');

  const fipeTexto = faixa === 'sem_fipe'
    ? 'FIPE não disponível para este veículo (marca/modelo/ano não bateram com a tabela, ou consulta ainda não feita).'
    : `Lance mínimo é ${percentualFipe.toFixed(1)}% da FIPE (R$ ${brl(v.valor_fipe)}, referência ${v.fipe_mes_referencia || 'não informada'}${v.fipe_status === 'aproximado' ? ' — valor APROXIMADO, mais de uma versão do modelo bateu com o ano' : ''}). Regra da casa: ATÉ 65% da FIPE é considerado ótimo ponto de entrada; acima de 100% (lance acima da própria FIPE) é sinal de alerta forte.`;

  return `Você avalia veículos de leilão para um investidor. Use SOMENTE o que está nos documentos anexos e na descrição abaixo — nunca invente característica, defeito ou ausência de defeito que não conste. Quando a informação não constar em lugar nenhum, diga explicitamente "não informado pelo leiloeiro" em vez de presumir.

DADOS DO LOTE (do sistema, não do documento — confie neles):
- ${[v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo'}${[v.ano_fabricacao, v.ano_modelo].filter(Boolean).length ? ` — ano ${[v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/')}` : ''}
- KM: ${v.km != null ? Number(v.km).toLocaleString('pt-BR') : 'não informado'} · Placa: ${v.placa || 'não informada'}
- Câmbio/combustível/cor: ${[v.cambio, v.combustivel, v.cor].filter(Boolean).join(' · ') || 'não informados'}
- Modalidade: ${v.modalidade === 'judicial' ? 'Judicial' : v.modalidade === 'extrajudicial' ? 'Extrajudicial' : 'não identificada'}
- Origem da venda: ${ORIGEM_PROMPT[v.origem_venda] || 'não identificada (o leiloeiro não informa quem vende)'}
- Forma de pagamento: ${v.forma_pagamento || 'não informada'}
- Lance mínimo: R$ ${brl(v.valor_minimo)}${v.valor_avaliacao > 0 ? ` · Avaliação do leiloeiro: R$ ${brl(v.valor_avaliacao)}` : ''}
${sinais ? `\nSINAIS JÁ IDENTIFICADOS PELO SISTEMA (vieram do próprio leiloeiro, confirme/aprofunde com o documento, não repita cru):\n- ${sinais}\n` : ''}
${fipeTexto}

DESCRIÇÃO DO LEILOEIRO:
${v.descricao ? v.descricao.slice(0, 4000) : '(nenhuma descrição textual — use só os documentos anexos, se houver)'}

TAREFA: com base em tudo acima e nos documentos anexos (se houver — edital/laudo/matrícula do veículo), responda SOMENTE JSON válido, sem markdown, neste formato:
{
  "parecer": "markdown curto (max ~350 palavras): condição do veículo (avarias, procedência, débitos/multas se constarem), o que o documento CONFIRMA ou CONTRADIZ da descrição, e o veredito final considerando o percentual da FIPE",
  "riscos": ["cada risco concreto encontrado — sinistro, sucata, IPVA em aberto, débito/multa nos documentos, financiamento restrito, etc. Vazio se nenhum."],
  "condicoesResumo": "uma frase objetiva sobre o estado geral do veículo",
  "recomendacao": "comprar" | "avaliar_com_cautela" | "evitar"
}
NUNCA presuma que o veículo está em bom estado por AUSÊNCIA de menção — ausência de informação é "não informado", não é sinal positivo.`;
}

// Origem da venda (25/09 — public.classificar_origem_veiculo): muda o que a análise deve checar.
const ORIGEM_PROMPT = {
  judicial: 'Judicial — há processo; confira no edital ônus, débitos que ficam com o arrematante e prazo de entrega',
  financeira: 'Financeira/banco — retomada de financiamento; costuma ter documentação regular, confira débitos anteriores',
  seguradora: 'Seguradora — sinistro ou recuperado de roubo; a MONTA (pequena/média/grande) e o histórico definem o valor',
  patio: 'Detran/pátio — removido ou apreendido; atenção a débitos, restrições (RENAJUD) e se sai com documento ou só baixa',
  orgao_publico: 'Órgão público — frota pública usada; desgaste de uso intenso é comum, manutenção costuma ser registrada',
  corporativo: 'Corporativo — empresa vendendo a própria frota; em geral manutenção em dia e documentação regular',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const veiculoId = String(req.body?.veiculoId || '').trim();
  if (!veiculoId) { res.status(400).json({ error: 'veiculoId obrigatório' }); return; }

  // Sempre lê o veículo FRESCO do banco — nunca confia num snapshot que o cliente mandou (foi
  // exatamente isso que causou o "lance mínimo ausente" do relatório de imóvel em 20/09: um
  // payload incompleto persistido e nunca mais atualizado).
  const rv = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(veiculoId)}&select=*&limit=1`);
  const [v] = rv.ok ? await rv.json() : [];
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }

  // Leilão já ocorrido → não gera e não cobra (mesma regra do imóvel, api/_leilao-encerrado.js).
  if (v.data_leilao && new Date(v.data_leilao).getTime() < Date.now()) {
    res.status(422).json({ error: 'Leilão já encerrado — não é possível gerar o relatório para este veículo.', leilaoEncerrado: true });
    return;
  }

  // ── Cota no servidor (mesmo padrão de consumir_analise_por) ──
  let cota = null;
  let cobrarCredito = false;
  try {
    const jaConcluida = await (await sb(`analises_veiculo?user_id=eq.${user.id}&veiculo_id=eq.${encodeURIComponent(veiculoId)}&status=eq.concluida&select=veiculo_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo) {
      const rc = await sb('rpc/consumir_veiculo_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null); // padrao-ok: leitura best-effort — cota null (rc falhou) cai no catch externo e NÃO bloqueia, mesmo padrão de api/gerar-analise.js
      if (cota && cota.ok === false) {
        const EST_VEICULO_MICRO = 400000; // ~US$0,40 (1 chamada, poucos documentos)
        const pode = await sb('rpc/pode_debitar', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_custo_micro_estimado: EST_VEICULO_MICRO }) });
        const podeCredito = await pode.json().catch(() => false); // padrao-ok: leitura falhou → nega crédito (resposta segura), nunca libera geração não paga
        if (podeCredito === true) {
          cobrarCredito = true;
        } else {
          res.status(402).json({ error: 'Sua cota mensal de análises de veículo acabou. Recarregue créditos para gerar relatórios adicionais.', motivo: 'sem_credito', cota });
          return;
        }
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  const T0 = Date.now();
  const HARD_MS = 105000; // < maxDuration 120s, deixa margem p/ gravar erro/concluída e responder

  const base = {
    user_id: user.id, veiculo_id: veiculoId,
    titulo: v.titulo || [v.marca, v.modelo].filter(Boolean).join(' ') || null,
    marca: v.marca || null, modelo: v.modelo || null, veiculo: v,
  };
  await upsertAnaliseVeiculo({ ...base, status: 'gerando', erro: null });

  const estornar = async () => {
    if (cota?.ok && cota.tipo && !cobrarCredito) {
      try { await sb('rpc/estornar_veiculo_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* best-effort */ }
    }
  };

  try {
    const percentualFipe = (v.valor_fipe > 0 && (v.fipe_status === 'ok' || v.fipe_status === 'aproximado') && v.valor_minimo > 0)
      ? (Number(v.valor_minimo) / Number(v.valor_fipe)) * 100
      : null;
    const faixa = faixaFipe(percentualFipe);

    const blocosDoc = await anexosParaBlocos(v.anexos, T0 + Math.min(45000, HARD_MS - 30000));
    const semDocumentos = blocosDoc.length === 0 && !String(v.descricao || '').trim();

    const content = [...blocosDoc, { type: 'text', text: promptVeiculo(v, percentualFipe, faixa) }];
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1400,
        system: 'Você é um avaliador de veículos de leilão. Responda SOMENTE JSON válido, sem markdown ao redor.',
        messages: [{ role: 'user', content }],
      }),
    }, { retries: 1, timeoutMs: Math.max(20000, HARD_MS - (Date.now() - T0) - 10000), noFallback: true });

    if (!r.ok) {
      let corpo = ''; try { corpo = await r.text(); } catch { /* sem corpo */ }
      throw new Error(`anthropic_http_${r.status}: ${corpo.slice(0, 300)}`);
    }
    const data = await r.json();
    try { registrarCustoGeracao('veiculo', { userId: user.id, custoMicro: custoRespostaClaude(MODEL, data?.usage), ok: true, meta: { veiculoId } }); } catch { /* medição não bloqueia */ }
    const parsed = parseJSON(extractText(data)) || {};

    if (!String(parsed.parecer || '').trim()) {
      // Sem parecer = falha, não "veículo sem informação" — estorna, nunca cobra o vazio
      // (mesma regra de "resposta de erro não é conteúdo válido" do CLAUDE.md).
      await estornar();
      await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: 'Resposta vazia da IA' });
      res.status(502).json({ error: 'Não foi possível gerar o relatório agora. Tente novamente.' });
      return;
    }

    const result = {
      parecer: parsed.parecer,
      riscos: Array.isArray(parsed.riscos) ? parsed.riscos.filter((r) => typeof r === 'string' && r.trim()) : [],
      condicoesResumo: typeof parsed.condicoesResumo === 'string' ? parsed.condicoesResumo : '',
      recomendacao: ['comprar', 'avaliar_com_cautela', 'evitar'].includes(parsed.recomendacao) ? parsed.recomendacao : null,
      fipeValor: v.valor_fipe || null, fipeStatus: v.fipe_status || null, fipeMesReferencia: v.fipe_mes_referencia || null,
      valorMinimo: v.valor_minimo || null, percentualFipe, faixaFipe: faixa,
      semDocumentos,
    };
    await upsertAnaliseVeiculo({ ...base, status: 'concluida', erro: null, result });

    if (cobrarCredito) {
      try {
        await sb('rpc/debitar_credito', { method: 'POST', body: JSON.stringify({
          p_user_id: user.id, p_func: 'veiculo', p_custo_micro: Math.round(custoRespostaClaude(MODEL, data?.usage)),
          p_justificativa: 'Análise de veículo (cota mensal esgotada)', p_referencia: veiculoId,
        }) });
      } catch { /* best-effort — nunca desfaz um relatório já entregue */ }
    }
    res.status(200).json({ ok: true, status: 'concluida' });
  } catch (e) {
    await estornar();
    await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: String(e?.message || e).slice(0, 500) });
    res.status(500).json({ error: 'Falha ao gerar o relatório do veículo.' });
  }
}
