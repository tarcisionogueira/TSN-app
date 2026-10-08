/**
 * Comprei (PGFN) — dados do bem pela API pública do anúncio (08/10, #185).
 *
 * Recon: o site é uma SPA; a API mora em https://comprei.pgfn.gov.br/gateway (lido de /conf.json).
 * `GET /anuncio/{id}` exige login (401), mas `GET /anuncio/visitar/{id}` é público e devolve o
 * anúncio inteiro. O Comprei NÃO publica arquivo (matrícula/laudo) sem login — o link "Matrícula
 * do Bem" é só para a equipe da PGFN. O que vem é estruturado e é o que o relatório precisa:
 * nº da matrícula, cartório, processo, juízo, ônus da matrícula (`observacaoGravames`), CEP,
 * bairro e logradouro. Aqui vira campos do lote + um bloco de texto para o documental ler.
 */
export const COMPREI_API = 'https://comprei.pgfn.gov.br/gateway';

export function idAnuncioComprei(url) {
  const m = String(url || '').match(/comprei\.pgfn\.gov\.br\/anuncio\/detalhe\/(\d+)/i);
  return m ? m[1] : null;
}

export const urlVisitarComprei = (id) => `${COMPREI_API}/anuncio/visitar/${id}`;

const TIPO_VIA = { R: 'Rua', AV: 'Avenida', ROD: 'Rodovia', EST: 'Estrada', TV: 'Travessa', AL: 'Alameda', PC: 'Praça', PCA: 'Praça', LGO: 'Largo', VL: 'Vila', QD: 'Quadra' };
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function fichaComprei(j) {
  if (!j || typeof j !== 'object' || !j.id) return null;
  // `logradouro` vem com sobra do cadastro dos Correios ("Tupaciguara - - De 399 Ao Fim - Lado Impar"):
  // o nome da via é o que vem antes do primeiro " - ".
  const via = limpa(String(j.logradouro || '').split(/\s-\s/)[0]);
  const tipo = TIPO_VIA[String(j.tipoLogradouro || '').toUpperCase()] || limpa(j.tipoLogradouro);
  const num = limpa(j.numeroEndereco);
  const endereco = via ? [`${tipo ? `${tipo} ` : ''}${via}`, num && !/^s\/?n/i.test(num) ? num : 's/n'].join(', ') : '';
  const cepDig = String(j.cep ?? '').replace(/\D/g, '');
  const cep = cepDig ? cepDig.padStart(8, '0').slice(-8) : null;
  const matricula = limpa(j.matricula) || null;
  const processo = Array.isArray(j.processos) && j.processos.length ? limpa(j.processos[0]) : null;
  const onus = limpa(String(j.observacaoGravames || '').replace(/\n/g, '; '));
  const partes = [
    matricula && `Matrícula(s): ${matricula}`,
    limpa(j.cartorio) && `Cartório: ${limpa(j.cartorio)}`,
    processo && `Processo: ${processo}${j.processos.length > 1 ? ` (+${j.processos.length - 1})` : ''}`,
    limpa(j.juizo) && `Juízo: ${limpa(j.juizo)}`,
    j.gravames === true ? `Ônus na matrícula: ${onus || 'há gravames (detalhe não informado)'}` : (j.gravames === false ? 'Ônus na matrícula: nenhum informado pela PGFN' : null),
  ].filter(Boolean);
  return {
    endereco: endereco.slice(0, 150),
    bairro: limpa(j.bairro).slice(0, 80),
    cep,
    numero_matricula: matricula ? matricula.slice(0, 60) : null,
    numero_processo: processo,
    vendido: j.bemVendido === true,
    bloco: partes.length ? `Dados do Comprei (PGFN): ${partes.join(' — ')}.` : '',
  };
}
