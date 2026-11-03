/**
 * NOTA METODOLÓGICA — o "rodapé em letras pequenas" (pedido do dono, 06/08).
 *
 * "Assim como funciona em apresentações fazendo o referenciamento: ter as letras pequenas no
 *  rodapé dizendo a metodologia de pesquisa e de análise realizada, para resguardo das
 *  informações em cima de um parecer. Isso vale para todos os relatórios e índices."
 *
 * A regra que faz este rodapé valer alguma coisa: ele é MONTADO DOS FATOS DAQUELA GERAÇÃO,
 * não é texto fixo. Se os comparáveis vieram da base própria, o rodapé diz isso e diz o
 * período; se vieram de pesquisa, diz a data da pesquisa; se a área usada foi a da matrícula,
 * diz que prevaleceu sobre o anúncio. Um rodapé padrão que repete a mesma frase em todo
 * relatório não resguarda nada — resguarda o rodapé que BATE com o relatório acima dele.
 *
 * Usado na tela e no PDF dos três relatórios e do Índice, com o mesmo texto, para o cliente
 * ler a mesma metodologia onde quer que veja o número.
 */
import { baseLocalDe } from './origem-amostras.js';
import { vendasDe } from './niveis-mercado.js';
import { fraseTerrenoExcedente } from './terreno-excedente.js';
// Texto puro do rodapé (03/11: saiu do .jsx para ser testável no Node — scripts/testes/mercadologico-quatro-casos.mjs).

const dataBr = (d) => {
  if (!d) return null;
  try {
    const x = new Date(d);
    return isNaN(x) ? null : x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return null; }
};
const mesBr = (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? String(m).split('-').reverse().join('/') : null);
const lista = (arr) => arr.filter(Boolean).join(' ');

/** Frases da metodologia do MERCADOLÓGICO, a partir de `mercado.metodologia`. */
export function frasesMercadologico(mercado, divergenciaArea, cidade) {
  const md = mercado?.metodologia;
  const f = [];
  const c = md?.comparaveis;
  // Origem real das amostras (03/11, caso Peruíbe: anúncios de São Paulo e Bauru descritos como "até ~1 km").
  const bl = baseLocalDe(mercado, cidade, vendasDe(mercado));
  const foraSemBase = bl.foraDaCidade > 0 && !bl.suficiente;
  if (c && foraSemBase && c.origem !== 'base_propria' && c.origem !== 'indice_bidpro') {
    const cs = (bl.cidadesFora || []).join(', ');
    f.push(`Comparáveis obtidos por pesquisa na internet${c.pesquisaEm ? ` em ${dataBr(c.pesquisaEm)}` : ''}: não foram encontrados anúncios suficientes do mesmo tipo na cidade do imóvel. ${bl.foraDaCidade} anúncio(s) de outras cidades${cs ? ` (${cs})` : ''} apareceram na pesquisa e NÃO entram na conta como comparável local; o valor de mercado é apenas indicativo e deve ser confirmado na região antes do lance.`);
  } else if (c) {
    const per = c.periodo ? ` Anúncios com referência entre ${mesBr(c.periodo.de)} e ${mesBr(c.periodo.ate)}.` : '';
    const qtd = `${c.nVendas || 0} comparável(is) de venda${c.nLocacoes ? ` e ${c.nLocacoes} de locação` : ''}`;
    if (c.origem === 'base_propria') {
      f.push(`Comparáveis obtidos da base própria BidPro (${qtd}), formada por anúncios de mercado livre já capturados nesta praça no recorte de ${c.nivelBase === 'bairro' ? 'bairro' : 'microrregião (~1 km)'}, sem nova pesquisa na internet nesta emissão.${per}`);
    } else if (c.origem === 'indice_bidpro') {
      f.push('Não foram localizados anúncios comparáveis ativos na região no momento da emissão; a estimativa de mercado usa o Índice BidPro, referência interna consolidada das análises da plataforma por microrregião e segmento, e não um comparativo de anúncio ao vivo.');
    } else if (c.origem === 'reaproveitado') {
      f.push(`Comparáveis reaproveitados de pesquisa recente do mesmo imóvel${c.pesquisaEm ? ` (${dataBr(c.pesquisaEm)})` : ''}: ${qtd}.${per}`);
    } else {
      const ampliou = (Number(mercado?.nivel3?.totalAmostras) || 0) > 0 || mercado?.raioAmpliado;
      f.push(`Comparáveis obtidos por pesquisa na internet${c.pesquisaEm ? ` em ${dataBr(c.pesquisaEm)}` : ''} em portais imobiliários e imobiliárias locais, restrita ao MESMO tipo de imóvel e a recortes de distância (mesmo condomínio/rua até ~250 m e entorno até ~1 km${ampliou ? '; por falta de amostra próxima, o raio foi ampliado até ~2 km' : ''}): ${qtd}.${per}`);
    }
  }
  if (c) {
    // COMO o R$/m² foi calculado — o texto descreve a conta que rodou (03/11, Pirituba: dizia "MEDIANA"
    // sobre uma média ponderada).
    const vp = mercado?.valorPonderado;
    const regraM2 = vp?.aplicado
      ? `O preço por m² é a MÉDIA PONDERADA por proximidade (peso 1/(1+d/250 m)) e por recência de ${vp.amostras} amostra(s) de venda, depois de excluir anúncios repetidos, de outra cidade e discrepantes (fora de 2,5× a mediana).`
      : vp && vp.aplicado === false
        ? `Base fina (${vp.amostras || 0} amostra(s) válida(s)): o preço por m² não pôde ser calculado pela média ponderada dos comparáveis e segue a estimativa da pesquisa, com margem de erro maior.`
        : '';
    f.push(`Anúncio de leilão é descartado da amostra (não representa mercado livre) e locação sem metragem não entra, por não permitir o cálculo de R$/m².${regraM2 ? ` ${regraM2}` : ''}`);
  }
  const te = mercado?.consolidado?.terrenoExcedente;
  if (te?.haExcedente) f.push(fraseTerrenoExcedente(te));
  const a = md?.area;
  if (a?.fonte === 'matricula') {
    f.push(`A área utilizada no cálculo (${a.valor} m²) é a declarada na MATRÍCULA do imóvel, que prevalece sobre a área do anúncio.`);
  } else if (a?.valor) {
    f.push(`A área utilizada no cálculo (${a.valor} m²) é a informada no anúncio do lote; não foi possível confirmá-la na matrícula nesta emissão.`);
  }
  if (divergenciaArea?.matricula) {
    f.push(`Divergência identificada: o anúncio informa ${divergenciaArea.anuncio} m² e a matrícula ${divergenciaArea.matricula} m² (${divergenciaArea.diferencaPct > 0 ? '+' : ''}${divergenciaArea.diferencaPct}%). Prevaleceu a matrícula.`);
  }
  const d = md?.documento;
  if (d?.editalLido) {
    f.push(`As praças, a forma de pagamento e os custos${d.custosLidos ? ' (comissão, taxa administrativa, IPTU e condomínio, quando declarados)' : ''} foram lidos do EDITAL do lote e usados nas projeções.`);
  } else if (d?.regrasOrigem === 'padrao_leiloeiro') {
    f.push('O edital deste lote não pôde ser lido automaticamente; as condições de pagamento indicadas seguem o padrão observado neste leiloeiro em editais anteriores e devem ser confirmadas no documento.');
  }
  const r = md?.referencias;
  if (r) {
    const ext = [r.fipeZap && 'FipeZAP', r.zoneamento && 'zoneamento municipal', r.seguranca && 'indicadores de segurança pública'].filter(Boolean);
    if (ext.length) f.push(`Referências externas consultadas: ${ext.join(', ')}.`);
    if (r.ibge) f.push('Os dados demográficos são do IBGE, com fonte e ano indicados em cada número; a leitura de pressão habitacional é interpretação da BidPro derivada do Censo, e não o déficit habitacional oficial.');
    if (r.indiceBidPro) f.push(`O Índice BidPro citado é referência interna por microrregião (nível ${r.indiceBidPro}), consolidada das análises já emitidas pela plataforma.`);
  }
  f.push('Os indicadores financeiros (ROI, ROE, TIR, VPL, payback e teto de lance) são calculados de forma determinística sobre os valores acima e os parâmetros informados na tela, sem interferência de inteligência artificial.');
  return f;
}

/** Frases da metodologia do DOCUMENTAL, a partir de `result.metodologia`. */
export function frasesDocumental(res) {
  const md = res?.metodologia;
  const f = [];
  const docs = md?.documentos || [];
  if (docs.length) {
    f.push(`Análise baseada na leitura automática de ${docs.length} documento(s) do lote: ${docs.map(d => d.rotulo || d.tipo).filter(Boolean).join(', ')}.`);
  } else if (md?.textoColado) {
    f.push('Análise baseada no texto de documento fornecido manualmente.');
  } else {
    f.push('Nenhum documento do lote pôde ser lido automaticamente nesta emissão.');
  }
  const c = md?.consultas;
  if (c?.cnj) f.push(`Consulta processual no DataJud/CNJ${c.cnj.porNome ? ' pelo nome da parte' : ''}: ${c.cnj.total} processo(s) localizado(s)${(c.cnj.tribunais || []).length ? ` em ${c.cnj.tribunais.join(', ')}` : ''}.`);
  if (c?.djen) f.push('Andamentos verificados no DJEN/Comunica CNJ.');
  // CERTIDÕES FISCAIS ENTRARAM NESTA LISTA EM 31/08. Elas eram anunciadas como "consultadas
  // automaticamente" e nunca foram: a ReceitaWS não tem endpoint de CPF (404 garantido para
  // executado pessoa física), a PGFN exige login gov.br e a CRF da Caixa exige captcha.
  // Prometer consulta que não acontece é pior do que dizer que ela é manual — o cliente
  // acreditaria numa checagem inexistente para decidir lance.
  f.push('Receita Federal, PGFN, FGTS, CNDT, CNIB e cartórios de protesto não são consultados automaticamente (exigem login, captcha ou acesso pago) e constam como diligência do jurídico.');
  const af = md?.antifraude;
  if (af) {
    f.push(lista([
      'Verificação de procedência:',
      af.fonteReconhecida === true ? 'leiloeiro integrado e monitorado pela plataforma;' : af.fonteReconhecida === false ? 'origem do lote não reconhecida pela plataforma;' : '',
      af.dvCnjValido === true ? 'dígito verificador do número CNJ conferido;' : af.dvCnjValido === false ? 'dígito verificador do número CNJ inválido;' : '',
      af.confirmadoDataJud === true ? 'processo confirmado no DataJud.' : af.confirmadoDataJud === false ? 'processo não confirmado no DataJud.' : '',
    ]));
  }
  if (md?.pendencias > 0) f.push(`${md.pendencias} item(ns) do checklist permanece(m) pendente(s) e está(ão) identificado(s) como diligência.`);
  if (md?.preliminar) f.push('Esta emissão é PRELIMINAR: parte da documentação não foi lida e o sistema fará nova tentativa automaticamente.');
  f.push('O que não consta na documentação analisada é assinalado como tal, com a indicação de onde confirmar; nada é presumido.');
  return f;
}

/** Frases da metodologia do LAUDO (síntese, sem fonte nova). */
export function frasesLaudo(res) {
  const md = res?.metodologia;
  const f = [
    'Este laudo é uma SÍNTESE: pondera as conclusões do relatório mercadológico e da análise documental já emitidos, sem realizar nova pesquisa de mercado nem nova consulta processual.',
  ];
  const dm = dataBr(md?.baseMercadologicoEm || res?.baseadoEm?.mercadoEm);
  const dd = dataBr(md?.baseDocumentalEm || res?.baseadoEm?.documentalEm);
  if (dm || dd) f.push(`Base: relatório mercadológico de ${dm || 'data não registrada'} e análise documental de ${dd || 'data não registrada'}. Alterações posteriores nesses relatórios não estão refletidas aqui.`);
  f.push('O controle de qualidade compara as duas visões e registra contradições e lacunas; veredito favorável com recomendação de revisão é rebaixado automaticamente para condicional.');
  return f;
}

/** Frases da metodologia do ÍNDICE. */
export function frasesIndice(regiao, tipo) {
  const f = [];
  const nivel = regiao?.nivel_label || regiao?.nivel;
  f.push(`Índice calculado sobre anúncios de mercado livre do tipo ${tipo || 'selecionado'} capturados pela plataforma${nivel ? `, no recorte de ${nivel}` : ''}${regiao?.n_amostras ? `, a partir de ${regiao.n_amostras} amostra(s)` : ''}.`);
  f.push('O valor por m² é a MEDIANA das amostras, não a média; as faixas popular, médio e alto correspondem aos percentis 25, 50 e 75 da praça. Anúncio de leilão é excluído da base.');
  if (regiao?.projetado) f.push('Não há amostra recente suficiente no recorte: o valor exibido foi projetado para a data de hoje pela curva de valorização da própria região, e está sinalizado como tal.');
  if (regiao?.aluguel_indisponivel) f.push('Não há locação medida no recorte; por isso o aluguel não é exibido. A plataforma não estima aluguel por regra de bolso sobre o preço de venda.');
  else if (regiao?.aluguel_origem) f.push(`O aluguel exibido foi medido em recorte mais amplo que o consultado (${regiao.aluguel_origem}) e está identificado com essa procedência.`);
  f.push('A base é alimentada por cada pesquisa do Índice e por cada relatório mercadológico emitido; cada pesquisa cobre um tipo de imóvel.');
  return f;
}

export const RESSALVA = 'Este material tem caráter informativo e de apoio à decisão. As informações provêm de anúncios públicos de terceiros, de documentos do próprio lote e de bases oficiais, e podem conter erros de origem ou estar desatualizadas na data da leitura. Não constitui laudo de avaliação nos termos da NBR 14653 nem parecer jurídico, e não substitui a vistoria presencial do imóvel, a leitura integral do edital e da matrícula atualizada, nem a orientação de profissional habilitado antes do lance.';

/**
 * Rodapé renderizado. `tipo`: 'mercadologico' | 'documental' | 'laudo' | 'indice'.
 * `dados`: o result (ou a região, no índice). Nunca quebra: sem metodologia, mostra a ressalva.
 */
/**
 * CONDIÇÕES DE PAGAMENTO — e, sobretudo, DE ONDE ELAS VIERAM (31/08, pedido do dono:
 * "as regras podem mudar de edital para edital, mesmo em judicial ou extrajudicial").
 *
 * A projeção parcelada usa entrada e prazo. Esses números podem vir do EDITAL daquele leilão,
 * do piso legal do art. 895 (aplicado por o lote ser judicial, sem ninguém ter lido o edital),
 * ou do default do sistema. Os três produzem uma parcela igualmente convincente na tela — e é
 * exatamente por isso que a procedência precisa estar escrita. Número sem procedência é
 * premissa com cara de fato apurado, e o cliente decide lance em cima dele.
 */
export function fraseCondicoesPagamento(cp) {
  if (!cp) return '';
  const ent = Number(cp.sinalPercentual) > 0 ? `entrada de ${String(cp.sinalPercentual).replace('.', ',')}%` : null;
  const pz = Number(cp.prazoMeses) > 0 ? `saldo em até ${cp.prazoMeses} meses` : null;
  const termos = [ent, pz].filter(Boolean).join(' e ');
  if (cp.somenteAVista) {
    return cp.origem === 'edital_veda'
      ? 'Condições de pagamento: o edital deste leilão VEDA expressamente o parcelamento — a projeção considera pagamento à vista.'
      : 'Condições de pagamento: à vista, conforme o cadastro do lote; o edital não foi lido nesta emissão para confirmar se há parcelamento disponível.';
  }
  const minimo = Number(cp.parcelaMinima) > 0 ? `, parcela mínima de R$ ${Math.round(Number(cp.parcelaMinima)).toLocaleString('pt-BR')}` : '';
  if (cp.origem === 'edital') {
    return `Condições de pagamento LIDAS NO EDITAL deste leilão${termos ? `: ${termos}${minimo}` : ''}. Confira no documento antes de dar lance.`;
  }
  // 03/11: o edital fala em parcelamento mas não diz tudo — a projeção NÃO é apresentada como confirmada.
  if (cp.origem === 'edital_incompleto') {
    const falta = Array.isArray(cp.faltando) && cp.faltando.length ? cp.faltando.join(' nem ') : 'todas as condições';
    return `Condições de pagamento PARCIALMENTE lidas no edital: o documento permite parcelar, mas não informa ${falta}${termos ? `; a projeção parcelada usa ${termos}${minimo}, completando com o piso legal` : ''}. NÃO confirmadas: confira no edital antes de dar lance.`;
  }
  if (cp.origem === 'cliente') {
    return `Condições de pagamento informadas por você${termos ? ` (${termos})` : ''}, não lidas em documento. Confirme no edital antes de dar lance.`;
  }
  if (cp.origem === 'padrao_legal') {
    return `Condições de pagamento NÃO confirmadas no edital: a projeção parcelada usa o piso legal do art. 895 do CPC para leilão judicial${termos ? ` (${termos})` : ''}, com o imóvel hipotecado ao juízo até a quitação. O edital deste leilão pode ser mais restritivo — confirme antes de dar lance.`;
  }
  return `Condições de pagamento NÃO confirmadas em documento${termos ? `: a projeção parcelada usa ${termos}, premissa do sistema` : ''}. Confirme no edital antes de dar lance.`;
}

/** Mesma nota em TEXTO puro — para o PDF, que monta HTML por string. */
export function notaMetodologicaTexto(tipo, dados, extra, condicoesPagamento = null) {
  let frases = [];
  try {
    if (tipo === 'mercadologico') frases = frasesMercadologico(dados?.mercado || dados, dados?.divergenciaArea || extra, dados?.cidade);
    else if (tipo === 'documental') frases = frasesDocumental(dados);
    else if (tipo === 'laudo') frases = frasesLaudo(dados);
    else if (tipo === 'indice') frases = frasesIndice(dados, extra);
  } catch { frases = []; }
  return `${frases.join(' ')} ${fraseCondicoesPagamento(condicoesPagamento)} ${RESSALVA}`;
}
