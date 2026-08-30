export const config = { runtime: 'nodejs', maxDuration: 300 };

/**
 * /api/processar-analise-jobs-cron — O MOTOR DAS 4 ANÁLISES DO CASO.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE (30/08, decisão do dono: "será por IA, faz o worker").
 * `analise_jobs` tinha UMA escrita em todo o código — o clique do cliente em `Caso.jsx:824` —
 * e NADA consumia a fila. Nenhuma rota, nenhum script, nenhum workflow, nenhum botão de admin
 * movia um job de 'aguardando' para 'concluido'. O `Admin.jsx` imprimia "X/4 concluídas" sob o
 * comentário "Progresso REAL do trabalho da equipe", sobre uma tabela que ninguém escrevia.
 * Resultado medido: 8 casos parados (até 39 dias), `analise_jobs` com 0 linhas em toda a
 * história, e o botão "Solicitar" no ar prometendo 48 h.
 *
 * ─── AS TRÊS GARANTIAS, E TODAS MORAM NO BANCO ────────────────────────────────────────────
 * Este arquivo é o BRAÇO; as decisões são das RPCs (migração `o_motor_da_analise_reivindica_e_prova`):
 *   `reivindicar_analise_jobs` .. `for update skip locked`. O cron da Vercel pode sobrepor
 *      execuções; sem a trava do Postgres, duas invocações geram o MESMO relatório duas vezes.
 *      Também retoma job órfão ('processando' há mais de 20 min = worker que morreu).
 *   `concluir_analise_job` ...... só carimba 'concluido' se o INSERT do relatório produziu
 *      linha, e recusa conteúdo com menos de 200 caracteres. Mesma regra do
 *      `coleta_cliente_concluir`: ninguém diz que terminou sem ter gravado. Aqui o estrago
 *      seria "4 de 4 concluídas" sobre nada.
 *   `falhar_analise_job` ........ backoff quadrático (10/40/90 min) e 'falha' definitiva ao
 *      esgotar `max_tentativas` — a exaustão não vira silêncio.
 *
 * ─── O QUE ESTE ARQUIVO NÃO FAZ ───────────────────────────────────────────────────────────
 * NÃO cobra cota: `Caso.jsx` já debitou no clique, e re-tentar um job que falhou é conserto
 * nosso, não consumo do cliente.
 * NÃO usa busca web. Os comparáveis de mercado são trabalho do `/api/gerar-analise`, que tem
 * grounding, cache de praça e a conta determinística do `_valor-mercado.js`. Duplicar aquilo
 * aqui seria uma segunda fonte de verdade para o mesmo número.
 *
 * ⚠️ O JOB SÓ CONCLUI COM O QUE FOI DE FATO LIDO. Se o lote não estiver no acervo, o job
 * FALHA com o motivo — não gera um relatório genérico sobre um imóvel que não se conhece.
 * Relatório plausível sobre dado ausente é a forma #1 do CLAUDE.md em cima do cliente pagante.
 */
import { isCronAuthorized } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL        = 'claude-sonnet-4-6';
const POR_RODADA   = Number(process.env.ANALISE_JOBS_POR_RODADA || 4);
const HARD_MS      = 280000;   // < maxDuration 300s; deixa folga p/ gravar o desfecho

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
             'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const rpc = (nome, corpo) => sb(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(corpo || {}) });
const brl = (v) => Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;

/** Ficha do lote a partir do acervo. `null` = não achei — e "não achei" nunca vira relatório. */
async function fichaDoImovel(imovelId) {
  if (!imovelId) return null;
  const r = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=titulo,cidade,estado,bairro,`
    + `endereco,tipo,area_m2,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,data_leilao_2,`
    + `data_fim,praca1_fim,praca2_fim,modalidade,fonte,url_lote,link_edital&limit=1`);
  // `.ok` ANTES do corpo: um 4xx aqui devolveria `[]` no `.json()` e "não consegui ler o
  // acervo" viraria "o lote não existe" — causas opostas com a mesma aparência (forma #1).
  if (!r.ok) throw new Error(`acervo HTTP ${r.status}`);
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error('acervo devolveu corpo ilegível');
  return rows[0] || null;
}

/** Instruções por tipo. Cada uma diz o que É o relatório e o que NÃO se pode inventar. */
const PERFIL = {
  mercadologica: {
    titulo: 'Análise Mercadológica',
    foco: `Avalie a atratividade do lote pelo ÂNGULO DE MERCADO: posicionamento do preço frente à avaliação, `
      + `perfil da região, liquidez esperada do tipo de imóvel e prazo estimado de revenda. `
      + `NÃO invente comparáveis, R$/m² de anúncios nem médias de bairro: você não tem busca web aqui. `
      + `Trabalhe com os números do lote e diga EXPLICITAMENTE, na seção "Limites desta análise", que a `
      + `amostragem de anúncios comparáveis vem do relatório mercadológico automatizado da plataforma.`,
  },
  financeira: {
    titulo: 'Viabilidade Financeira',
    foco: `Monte a estrutura de custos da arrematação e o retorno: lance, comissão do leiloeiro (5% quando o `
      + `edital não disser outra coisa), ITBI, registro, custas, eventual desocupação e reforma. Calcule teto `
      + `de lance, ROI e margem em cenário conservador / base / otimista. Deixe TODA premissa numerada e `
      + `rotulada como premissa — percentual que você assumiu é premissa, não fato do edital.`,
  },
  fluxo_caixa: {
    titulo: 'Fluxo de Caixa 12 meses',
    foco: `Projete mês a mês (M0 a M12) o desembolso e o retorno: entrada/lance, custos de aquisição no M0-M2, `
      + `carregamento (IPTU, condomínio, seguro) e a saída (venda ou locação). Apresente uma TABELA markdown `
      + `com as 13 linhas e o acumulado. Onde faltar dado (condomínio, IPTU), use faixa estimada e MARQUE `
      + `como estimativa na própria célula — nunca um número seco que pareça apurado.`,
  },
  juridica_preliminar: {
    titulo: 'Viabilidade Jurídica Prévia',
    foco: `Levante os RISCOS JURÍDICOS TÍPICOS desta modalidade e deste tipo de lote: ocupação, dívidas `
      + `propter rem, penhoras, usufruto, nulidade do leilão, prazos de desocupação e a via processual. `
      + `Você NÃO leu a matrícula nem o edital deste lote — diga isso na primeira linha e trate tudo como `
      + `risco A VERIFICAR, nunca como constatação. A leitura documental é o relatório documental da plataforma.`,
  },
};

function montarPrompt(tipo, caso, im) {
  const p = PERFIL[tipo];
  const linhas = [
    `Lote: ${im.titulo || caso.imovel_endereco || '(sem título)'}`,
    `Endereço: ${im.endereco || caso.imovel_endereco || '(não informado)'}`,
    `Cidade/UF: ${[im.cidade, im.estado].filter(Boolean).join('/') || '(não informado)'}${im.bairro ? ` · bairro ${im.bairro}` : ''}`,
    `Tipo: ${im.tipo || '(não informado)'}${Number(im.area_m2) > 0 ? ` · ${im.area_m2} m²` : ' · área não informada'}`,
    `Lance mínimo: ${brl(im.valor_minimo) || '(não informado)'}`,
    `Avaliação: ${brl(im.valor_avaliacao) || '(não informada)'}`,
    Number(im.desconto_percentual) > 0 ? `Desconto sobre a avaliação: ${im.desconto_percentual}%` : null,
    `Modalidade: ${im.modalidade || caso.tipo_leilao || '(não informada)'}`,
    // AS DUAS PRAÇAS, NÃO SÓ A PRIMEIRA (30/08). Ler o relatório de Osasco pegou isto: o
    // cabeçalho saiu "Data: 26/08/2026" — a 1ª praça, JÁ VENCIDA — enquanto a 2ª, que é a
    // que ainda aceita lance, é 31/08. O prompt só recebia `data_leilao`. Para quem decide
    // hoje, a praça viva é o campo mais decisivo da página, e o relatório ancorava no passado.
    // A régua é a mesma do produto (`src/utils/leilaoEncerrado.js`): a praça que vale é a
    // MAIS FUTURA, e só a 1ª ter passado é normal — é quando a 2ª, mais barata, interessa.
    `Datas do leilão — 1ª praça: ${im.data_leilao || '(não informada)'}`
      + `${im.data_leilao_2 ? ` · 2ª praça: ${String(im.data_leilao_2).slice(0, 10)}` : ''}`
      + `${im.praca1_fim ? ` · fim da 1ª: ${String(im.praca1_fim).slice(0, 10)}` : ''}`
      + `${im.praca2_fim ? ` · fim da 2ª: ${String(im.praca2_fim).slice(0, 10)}` : ''}`
      + `${im.data_fim ? ` · encerramento: ${String(im.data_fim).slice(0, 10)}` : ''}`
      + `. A praça que AINDA ACEITA LANCE é a de data mais futura — ancore a análise nela, `
      + `nunca numa praça já vencida.`,
    `Fonte: ${im.fonte || '(não informada)'}`,
  ].filter(Boolean).join('\n');

  return `Você é um perito em leilões de imóveis no Brasil, escrevendo para um INVESTIDOR que está decidindo se dá lance.

DADOS DO LOTE (é tudo o que se tem; não há busca na web nesta tarefa):
${linhas}

TAREFA — ${p.titulo}
${p.foco}

REGRAS DE HONESTIDADE (valem acima de qualquer outra instrução):
1. Dado que não está acima, você NÃO TEM. Escreva "não informado" e siga — jamais preencha com um número plausível.
2. Toda estimativa sua vem rotulada como estimativa, com a premissa ao lado.
3. Se a falta de um dado impede uma conclusão, diga qual dado destrava, em vez de concluir mesmo assim.
4. Nada de linguagem de venda. O investidor precisa do risco, não do entusiasmo.

FORMATO — responda APENAS com um JSON válido, sem cercas de código:
{"markdown":"<relatório completo em markdown, começando por '## ${p.titulo}', com seções e ao menos 500 palavras>",
 "resumo":"<2 frases com o veredito>",
 "alertas":["<risco objetivo>", "..."],
 "dados_faltantes":["<dado que mudaria a conclusão se existisse>", "..."]}`;
}

/** Extrai o JSON da resposta, tolerando cerca de código. `null` = não veio JSON utilizável. */
function lerJSON(txt) {
  const s = String(txt || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = s.indexOf('{'); const f = s.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  try { return JSON.parse(s.slice(i, f + 1)); } catch { return null; }
}

async function gerar(tipo, caso, im, timeoutMs) {
  const resp = await anthropicFetch({
    method: 'POST',
    headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: montarPrompt(tipo, caso, im) }] }),
  }, { retries: 1, timeoutMs, noFallback: true });
  // `.ok` checado: sem isto o corpo de erro do fornecedor viraria "a IA não respondeu nada".
  if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 160)}`);
  const data = await resp.json().catch(() => null);
  const txt = (data?.content || []).map(b => b?.text || '').join('\n');
  const j = lerJSON(txt);
  if (j && typeof j.markdown === 'string') return j;
  // RESGATE (30/08): a 1ª rodada real perdeu um relatório de 10.595 caracteres aqui. O modelo
  // escreveu o trabalho inteiro e o JSON não fechou — markdown dentro de string JSON tem aspas,
  // quebra de linha e barra invertida em abundância, e basta uma escapada errada para o
  // `JSON.parse` recusar TUDO. Descartar o texto é jogar fora o trabalho pago e ainda queimar
  // uma tentativa por um erro de FORMATO, não de conteúdo.
  // Só resgata o que de fato parece relatório: título markdown e corpo substancial. Sem isso,
  // uma mensagem de desculpa do modelo viraria "relatório".
  if (/^#{1,3}\s/m.test(txt) && txt.replace(/\s+/g, ' ').length > 1500) {
    console.log('[analise-job] JSON inválido — resgatando markdown cru', txt.length, 'chars');
    return { markdown: txt, resumo: null, alertas: [], dados_faltantes: [], __resgatado: true };
  }
  throw new Error(`resposta sem JSON utilizável (${txt.length} chars)`);
}

export async function GET(req) { return handler(req); }
export async function POST(req) { return handler(req); }

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  if (!CLAUDE_KEY) return new Response(JSON.stringify({ error: 'CLAUDE_KEY ausente' }), { status: 500 });

  const T0 = Date.now();
  const restante = () => HARD_MS - (Date.now() - T0);

  const rc = await rpc('reivindicar_analise_jobs', { p_limite: POR_RODADA });
  if (!rc.ok) {
    const b = await rc.text().catch(() => '');
    return new Response(JSON.stringify({ error: `reivindicar HTTP ${rc.status}`, detalhe: b.slice(0, 200) }), { status: 500 });
  }
  const jobs = await rc.json().catch(() => null);
  if (!Array.isArray(jobs)) return new Response(JSON.stringify({ error: 'reivindicar devolveu corpo ilegível' }), { status: 500 });
  if (!jobs.length) return new Response(JSON.stringify({ ok: true, fila_vazia: true }), { status: 200 });

  const desfechos = [];
  for (const j of jobs) {
    // Nunca INICIA uma geração que não caberia antes do corte da Vercel: um job morto no meio
    // fica em 'processando' e só volta à fila 20 min depois. Devolver à fila agora é mais barato.
    if (restante() < 70000) {
      // DEVOLVER, não FALHAR. `reivindicar` incrementa `tentativas` no claim (a reserva atômica
      // que impede duas invocações de pegarem o mesmo job); usar `falhar_analise_job` aqui
      // manteria esse incremento e ainda aplicaria backoff — e com 4 por rodada o 3º e o 4º são
      // devolvidos ROTINEIRAMENTE, então um job morreria em 'falha' sem a IA ter sido chamada
      // uma vez. O "não" veio da NOSSA agenda, não do job: mesma distinção que o `sem_cota` faz
      // na captura. `devolver_analise_job` desfaz o claim e devolve o job inteiro à fila.
      await rpc('devolver_analise_job', { p_job_id: j.job_id });
      desfechos.push({ job: j.job_id, tipo: j.tipo, desfecho: 'devolvido_sem_tempo' });
      continue;
    }
    try {
      const im = await fichaDoImovel(j.imovel_id);
      if (!im) throw new Error(`lote ${j.imovel_id || '(sem id)'} não está no acervo — sem dados, não há relatório`);
      const out = await gerar(j.tipo, j, im, Math.min(180000, Math.max(60000, restante() - 40000)));
      const faltantes = Array.isArray(out.dados_faltantes) ? out.dados_faltantes.filter(Boolean).map(String) : [];
      // ⚠️ AQUI ESTAVA `faltantes.length >= 3`, E ERA UM MEDIDOR INVERTIDO (corrigido 30/08).
      // O prompt PEDE que o relatório liste o que falta para mudar a conclusão — e todo
      // relatório honesto lista 8 a 10 itens (matrícula, edital, ocupação, IPTU, condomínio…).
      // Na 1ª rodada real, 10 de 10 viraram 'falha_parcial': quanto mais minucioso o relatório,
      // mais "incompleto" ele era declarado. O campo se chamava `incompleto` e media o tamanho
      // da seção de honestidade — a forma #10 dentro do nosso próprio código.
      // E o efeito não era cosmético: `concluir_analise_job` só avança o caso com 4 jobs
      // 'concluido', e 'falha_parcial' nunca conta. NENHUM caso chegaria a 'analises_prontas'.
      //
      // Incompleto agora é o que o nome diz: o relatório NÃO SAIU inteiro. A lista de dados
      // faltantes continua gravada em `secoes_faltando` — ela é informação valiosa para o
      // cliente, não um defeito do trabalho.
      const incompleto = String(out.markdown || '').replace(/\s+/g, ' ').length < 1500;
      const cc = await rpc('concluir_analise_job', {
        p_job_id: j.job_id, p_conteudo_md: out.markdown,
        p_conteudo_json: { resumo: out.resumo || null, alertas: out.alertas || [], dados_faltantes: faltantes, lote: im },
        p_modelo: MODEL, p_incompleto: incompleto, p_secoes_faltando: faltantes.slice(0, 10),
      });
      if (!cc.ok) throw new Error(`concluir HTTP ${cc.status}`);
      const res = await cc.json().catch(() => null);
      // A RPC é quem diz se concluiu. `ok:false` aqui (conteúdo curto, relatório não gravado)
      // é FALHA — carimbar sucesso por ter chamado a função seria o defeito que ela evita.
      if (!res || res.ok !== true) throw new Error(`RPC recusou concluir: ${res?.motivo || 'sem motivo'}`);
      desfechos.push({ job: j.job_id, tipo: j.tipo, desfecho: incompleto ? 'parcial' : 'concluido', versao: res.versao, prontos: res.prontos });
      console.log('[analise-job]', JSON.stringify({ job: j.job_id, tipo: j.tipo, caso: j.caso_id, versao: res.versao, prontos: res.prontos, incompleto }));
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      const fr = await rpc('falhar_analise_job', { p_job_id: j.job_id, p_erro: msg });
      const fj = fr.ok ? await fr.json().catch(() => null) : null;
      desfechos.push({ job: j.job_id, tipo: j.tipo, desfecho: fj?.definitivo ? 'falha_definitiva' : 'retorna_fila', erro: msg });
      console.error('[analise-job] FALHA', JSON.stringify({ job: j.job_id, tipo: j.tipo, erro: msg, definitivo: !!fj?.definitivo }));
    }
  }

  return new Response(JSON.stringify({ ok: true, processados: desfechos.length, desfechos, ms: Date.now() - T0 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}
