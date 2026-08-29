// A LINHA DO BANCO VIRA O OBJETO QUE AS TELAS USAM — um lugar só (29/08).
// Este mapeamento vivia dentro de `ImovelDetalhe.jsx`, e o comentário lá dentro conta o preço
// de tê-lo solto: `select('*')` sempre trouxe `praca1_fim`/`praca2_fim`, faltava MAPEAR — e a
// tela dava por encerrado um lote em pregão. Toda tela nova que precisar de um imóvel completo
// (a triagem passou a precisar) tem de partir daqui, não de uma cópia: coluna nova esquecida
// numa cópia é exatamente a falha que não aparece em revisão de código.
export function imovelDaLinha(data) {
  if (!data) return null;
  return {
        id: data.id, titulo: data.titulo, tipo: data.tipo, modalidade: data.modalidade,
        estado: data.estado, cidade: data.cidade, bairro: data.bairro, endereco: data.endereco,
        valorAvaliacao: data.valor_avaliacao, valorMinimo: data.valor_minimo,
        descontoPercentual: data.desconto_percentual, areaM2: data.area_m2, descricao: data.descricao,
        urlLote: data.url_lote || data.link_edital || data.link_regras_venda, linkEdital: data.link_edital, linkMatricula: data.link_matricula, linkRegrasVenda: data.link_regras_venda,
        foto: data.link_foto, leiloeiro: data.leiloeiro, dataLeilao: data.data_leilao,
        valorMinimo2: data.valor_minimo_2 ?? null, dataLeilao2: data.data_leilao_2 ?? null,
        // O `select('*')` sempre trouxe estas colunas; faltava MAPEAR. Sem elas o
        // `leilaoEncerrado` da tela decidia pelo início da 2ª praça e dava por encerrado
        // um lote em pregão (Guarulhos, 28/08). Mapear é o conserto, não consultar mais.
        dataFim: data.data_fim ?? null,
        praca1Fim: data.praca1_fim ?? null, praca2Fim: data.praca2_fim ?? null,
        pagamento: [data.forma_pagamento], fonte: data.fonte, fonteId: data.fonte_id,
        numeroEdital: data.numero_edital, numeroMatricula: data.numero_matricula,
        numeroProcesso: data.numero_processo, anexos: data.anexos || null, enriquecidoEm: data.enriquecido_em,
        latitude: data.latitude, longitude: data.longitude, pontosProximos: data.pontos_proximos, geocodNivel: data.geocod_nivel,
        scoreFinanceiro: data.score_financeiro ?? null,
        scoreJuridico: data.score_juridico ?? null,
        scoreLocalizacao: data.score_localizacao ?? null,
        valorMercado: data.valor_mercado ?? null,
        analiseViavel: data.analise_viavel ?? null,
        fichaCef: data.ficha_cef || null,
        fichaJuridica: data.ficha_juridica || null,
        ocupacao: data.ocupacao || null,
        // Fatos lidos no edital/matrícula (nome do condomínio, despesas mensais, custos da
        // arrematação, área da matrícula) — publicados por quem leu o documento.
        nomeCondominio: data.nomecondominio || null,
        docFatos: data.doc_fatos || null, docFatosEm: data.doc_fatos_em || null,
  };
}

