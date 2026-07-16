// Loop de aprendizado unificado dos agentes — APRENDER NA EMISSÃO (todos os relatórios).
//
// Cada gerador (mercadológico/documental/laudo) grava, ao emitir, uma lição DURÁVEL:
// corpus (fatos observados) + qualidade/vícios (o que faltou/assumiu) em agente_aprendizado.
// Sem chamada de IA extra (custo zero). Tabela SEPARADA de analises_* → sobrevive à
// exclusão do relatório não-arrematado.
//
// POISON-RESISTENTE: guarde só dado do imóvel (scraper), da pesquisa (servidor) ou dos
// documentos — NUNCA valor derivado de input do usuário (ex.: valorMercado depende do
// areaM2 do cliente), p/ não envenenar o aprendizado coletivo que realimenta todos.

export async function aprenderNaEmissao(sb, { agente, imovel, corpus = {}, qualidade = {} }) {
  try {
    await sb('agente_aprendizado', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agente,
        imovel_id: String(imovel?.id || imovel?.imovel_id || ''),
        cidade: imovel?.cidade || null,
        uf: imovel?.estado || null,
        tipo: imovel?.tipo || null,
        modalidade: imovel?.modalidade || null,
        corpus,
        qualidade,
      }),
    });
  } catch { /* best-effort: aprendizado nunca bloqueia o relatório */ }
}

// Dos sinais de qualidade, retorna o MOTIVO para REGERAR (csv) ou null — o "apontamento"
// do moderador: relatório com vício que uma regeração (após backfill de dado / retry de
// fonte) pode corrigir, p/ o erro não se repetir. Vícios "permanentes" (dado que não
// existe) são filtrados no cron de regeneração pela contagem de tentativas.
const VICIOS_REGEN = [
  'avaliacao_ausente', 'minimo_ausente', 'valor_sentinela',
  'matricula_nao_lida', 'edital_nao_lido', 'cnj_nao_consultado',
  'mercado_vazio', 'modalidade_indefinida',
  'recomenda_revisao', 'tem_contradicoes', 'tem_lacunas_criticas',
];

export function vicioRegen(qualidade = {}) {
  const v = VICIOS_REGEN.filter((k) => qualidade[k]);
  return v.length ? v.join(',') : null;
}
