/**
 * PÁTIO DO VEÍCULO — classificador ÚNICO de todos os coletores (05/10). Antes vivia só dentro de
 * scraper-puppeteer.mjs; Astavero e Nordeste gravavam 'indefinido' fixo e sumiam da busca (0 de 143).
 *
 * Quatro estados (regra do dono — 11/09 e opção 2 de 05/10):
 *  · confirmado     — prova textual de pátio/depósito do leiloeiro            → aparece
 *  · nao_confirmado — local de vistoria/visitação informado, sem sinal de devedor → aparece COM SELO
 *  · indefinido     — nada, ou "em mãos de <pessoa>" (pode ser o devedor)        → não aparece
 *  · excluido       — sinal de bem com o executado/devedor                        → nunca é gravado
 *
 * Calibrado com trechos REAIS do acervo (05/10): "bem encontra-se COM O EXECUTADO no endereço…" (Superbid)
 * não era pego como executado — só "em poder/posse do executado" —; "Depósito: Em mãos de Nathael…" (FB)
 * é ambíguo e fica indefinido; "Local para vistoria: rua…" (Damiani) e "Localização do Bem: …" (Nordeste)
 * viram nao_confirmado.
 */
// "Bem encontra-se: <endereço>" é a frase-padrão da Sodré para onde o veículo está guardado (11/09, 47/47
// lotes reais) — fica FORA do \b…\b: o \b não casa depois de ":" + espaço.
export const SINAL_PATIO = /\b(p[áa]tio|apreendid[oa]|recolhid[oa] ao dep[óo]sito|dep[óo]sito do leiloeiro|j[áa] recolhido|dispon[íi]vel para retirada|retirado do dev[eê]dor|comitente\s*[:\-]?\s*(banco|financeira|seguradora|arrendadora))\b|bem encontra-se\s*:/i;
export const SINAL_EXECUTADO = /\b(n[ãa]o localizado|sujeito a busca e apreens[ãa]o|em poder d[oa] (executad[oa]|devedor[a]?)|posse d[oa] (executad[oa]|devedor[a]?)|aguardando localiza[çc][ãa]o|bem n[ãa]o recolhido|com [oa] (executad[oa]|devedor[a]?|parte executada)|em m[ãa]os d[oa] (executad[oa]|devedor[a]?))\b/i;
// "em mãos de <alguém>" que não seja leiloeiro/pátio/depósito: a pessoa pode ser o próprio devedor.
const SINAL_EM_MAOS_DE_PESSOA = /em m[ãa]os de\s+(?!.{0,40}(leiloeir|p[áa]tio|dep[óo]sito))/i;
const SINAL_LOCAL_INFORMADO = /(local\s+(para|de)\s+vistoria|vistoria\s*:|localiza[çc][ãa]o do bem|local do bem|bem (se )?encontra-se|endere[çc]o (do bem|para visita[çc][ãa]o|de visita[çc][ãa]o)|visita[çc][ãa]o\s*:)/i;

export function classificarPatio(texto) {
  const t = String(texto || '');
  if (SINAL_EXECUTADO.test(t)) return { status: 'excluido', motivo: 'sinal textual de bem ainda não recolhido/apreendido' };
  if (SINAL_PATIO.test(t)) return { status: 'confirmado', motivo: 'sinal textual de bem já em pátio/disponível' };
  if (SINAL_EM_MAOS_DE_PESSOA.test(t)) return { status: 'indefinido', motivo: 'bem "em mãos de" uma pessoa — pode ser o devedor' };
  if (SINAL_LOCAL_INFORMADO.test(t)) return { status: 'nao_confirmado', motivo: 'local de vistoria informado, sem sinal de devedor — pátio não confirmado' };
  return { status: 'indefinido', motivo: 'sem sinal textual claro nos dois sentidos — não exibir por padrão' };
}

/** Lote que não foi relido hoje não pode rebaixar um 'confirmado' já provado (herança de leilão à parte). */
export function patioPreservado(atual, anterior) {
  const fraco = atual?.status_patio === 'indefinido' || atual?.status_patio === 'nao_confirmado';
  return fraco && anterior?.status_patio === 'confirmado' && !String(anterior.status_patio_motivo || '').startsWith('leilão de pátio');
}
