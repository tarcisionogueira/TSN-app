/**
 * FILA DE COLETA da família sitemap DefaultClean (scraper-pecini.mjs: PECINI, SUBLIME, PW) — puro, sem rede
 * nem banco, testado em scripts/testes/pecini-fila.mjs sobre o sitemap REAL do Sublime de 24/10.
 *
 * POR QUE SAIU DO SCRAPER (24/10, pendência #358): a fila era `novos.length ? novos : antigos`. No Sublime o
 * sitemap lista ~110 lotes e ~16 deles NUNCA viram linha em imoveis_leilao (carro, moto, máquina, lote
 * reprovado na qualidade) — então eram "novos" para sempre. Toda rodada abria os mesmos 16, recusava os 16,
 * gravava `nada pronto (0 sem detalhe, 16 reprovados)` e os 45 imóveis JÁ gravados nunca eram relidos:
 * 31 com praça futura ficaram 4+ dias sem toque (`acervo_lotes_fantasma()`), parados desde 27–30/09.
 *
 * Três correções, todas aqui:
 *   1. o que o ENDEREÇO já diz que não é imóvel sai da fila antes de ocupar vaga (sem abrir a página);
 *   2. lote recusado há pouco (memória `coleta_lote_recusado`, a mesma do motor) não volta como "novo";
 *   3. no caminho GRÁTIS (runner residencial), a vaga que sobra dos novos vai para os antigos ATIVOS, do
 *      mais velho para o mais novo — o mesmo "a folga vira releitura" do motor (planejarAlvo). No caminho
 *      PAGO (Bright Data) a regra antiga fica: releitura nunca paga.
 * Lote desativado não volta pela releitura (o upsert grava `ativo: true` e o ressuscitaria).
 */

// Não-imóvel pelo ENDEREÇO do lote (slug do leilão). Palavra INTEIRA ("terreno-em-fordlandia-pa" não é Ford).
// 24/10: + motocicleta(s) — "/lote/2-motocicletas-em-cruzeiro/3219/" passava (só `motos?` casava) e o
// "Lote principal" das duas motos foi gravado como TERRENO; + máquina(s)/equipamento(s)/gerador(es)/sucata(s)/
// mancal/turbina — "/lote/maquinas-industriais-em-canas-sp/3454/" idem.
export const RE_NAO_IMOVEL_SLUG = new RegExp('\\/lote\\/(?:[^/]*-)?('
  + 'veiculos?|motos?|motocicletas?|motociclos?|carros?|caminh(?:ao|oes)|onibus|'
  + 'mercedes|fiat|hyundai|honda|toyota|chevrolet|volkswagen|vw|ford|renault|nissan|jeep|peugeot|citroen|yamaha|'
  + 'maquinas?|equipamentos?|gerador(?:es)?|sucatas?|mancal|turbinas?'
  + ')(?:-|\\/)', 'i');
export const RE_VEICULO_TITULO = /\b(mercedes|fiat|hyundai|honda|toyota|chevrolet|volkswagen|vw|ford|renault|nissan|jeep|peugeot|citro[eë]n|bmw|audi|kia|mitsubishi|yamaha|motocicletas?|caminh[ãa]o|ve[íi]culo)\b|\bmod(?:elo|\.)\s*(19|20)\d{2}\b/i;
// O <title>/og:title da plataforma termina com a CATEGORIA do lote: "… Casas em leilão | Sublime Leilões",
// "Lote principal | Exercício de preferência Motos em leilão | Sublime Leilões". O parseDetalhe corta esse
// sufixo do título — então a categoria é lida ANTES, aqui. Só categorias que nunca são imóvel.
export const RE_CATEGORIA_NAO_IMOVEL = /\b(motos|ve[íi]culos|carros|caminh[õo]es|m[áa]quinas|equipamentos|sucatas|utilit[áa]rios)\s+em\s+leil[ãa]o\b/i;

export const naoImovelPeloEndereco = (url) => RE_NAO_IMOVEL_SLUG.test(String(url || ''));
export const naoImovelPelaPagina = (url, titulo = '', tituloCru = '') =>
  naoImovelPeloEndereco(url) || RE_VEICULO_TITULO.test(titulo || '') || RE_CATEGORIA_NAO_IMOVEL.test(tituloCru || '');

/**
 * @param lotes      [{ id, loteUrl }] do sitemap (já sem os sem URL)
 * @param noBanco    Map fonte_id → { atualizado_em, ativo }
 * @param recusados  Set de fonte_id com recusa ainda válida (coleta_lote_recusado.rever_apos > agora)
 * @param releituraLivre  true só no caminho grátis (PECINI_HEADLESS=1)
 * @param alvo       'novos' (padrão) | 'antigos' | 'todos' — PECINI_ALVO, mantido
 * @param filtrarNaoImovel  false na PECINI (slug "<cidade>-<uf>", sem tipo de bem — como sempre foi)
 */
export function planejarFilaSitemap({ lotes, noBanco, recusados = new Set(), prefixo, maxLotes, releituraLivre = false, alvo = 'novos', filtrarNaoImovel = true }) {
  const fid = (l) => `${prefixo}${l.id}`;
  const foraPeloEndereco = filtrarNaoImovel ? lotes.filter(l => naoImovelPeloEndereco(l.loteUrl)) : [];
  const fora = new Set(foraPeloEndereco.map(fid));
  // Já gravado como imóvel e o endereço diz que não é: sai do acervo (motivo `nao_imovel`, como no motor).
  const naoImovelNoAcervo = foraPeloEndereco.map(fid).filter(k => noBanco.get(k)?.ativo);
  const candidatos = lotes.filter(l => !fora.has(fid(l)));
  const novos = candidatos.filter(l => !noBanco.has(fid(l)) && !recusados.has(fid(l)));
  const antigos = candidatos.filter(l => noBanco.get(fid(l))?.ativo)
    .sort((a, b) => String(noBanco.get(fid(a))?.atualizado_em || '').localeCompare(String(noBanco.get(fid(b))?.atualizado_em || ''))
      || (a.id < b.id ? -1 : 1));
  const fila = alvo === 'antigos' ? antigos
    : alvo === 'todos' || releituraLivre ? [...novos, ...antigos]
    : (novos.length ? novos : antigos);
  const filaCortada = fila.slice(0, maxLotes);
  return {
    fila: filaCortada, novos, antigos, foraPeloEndereco, naoImovelNoAcervo,
    recusadosPulados: lotes.filter(l => recusados.has(fid(l)) && !noBanco.has(fid(l))).length,
    iReleitura: Math.min(alvo === 'antigos' ? 0 : novos.length, filaCortada.length),
  };
}
