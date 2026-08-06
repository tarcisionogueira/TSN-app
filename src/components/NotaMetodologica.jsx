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
import React from 'react';

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
export function frasesMercadologico(mercado, divergenciaArea) {
  const md = mercado?.metodologia;
  const f = [];
  const c = md?.comparaveis;
  if (c) {
    const per = c.periodo ? ` Anúncios com referência entre ${mesBr(c.periodo.de)} e ${mesBr(c.periodo.ate)}.` : '';
    const qtd = `${c.nVendas || 0} comparável(is) de venda${c.nLocacoes ? ` e ${c.nLocacoes} de locação` : ''}`;
    if (c.origem === 'base_propria') {
      f.push(`Comparáveis obtidos da base própria BidPro (${qtd}), formada por anúncios de mercado livre já capturados nesta praça no recorte de ${c.nivelBase === 'bairro' ? 'bairro' : 'microrregião (~1 km)'}, sem nova pesquisa na internet nesta emissão.${per}`);
    } else if (c.origem === 'indice_bidpro') {
      f.push('Não foram localizados anúncios comparáveis ativos na região no momento da emissão; a estimativa de mercado usa o Índice BidPro, referência interna consolidada das análises da plataforma por microrregião e segmento, e não um comparativo de anúncio ao vivo.');
    } else if (c.origem === 'reaproveitado') {
      f.push(`Comparáveis reaproveitados de pesquisa recente do mesmo imóvel${c.pesquisaEm ? ` (${dataBr(c.pesquisaEm)})` : ''}: ${qtd}.${per}`);
    } else {
      f.push(`Comparáveis obtidos por pesquisa na internet${c.pesquisaEm ? ` em ${dataBr(c.pesquisaEm)}` : ''} em portais imobiliários e imobiliárias locais, restrita ao MESMO tipo de imóvel e a dois recortes de distância (mesmo condomínio/rua até ~250 m e entorno até ~1 km): ${qtd}.${per}`);
    }
    f.push('Anúncio de leilão é descartado da amostra (não representa mercado livre) e locação sem metragem não entra, por não permitir o cálculo de R$/m². O preço por m² é a MEDIANA das amostras, não a média, para reduzir o efeito de valores extremos.');
  }
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
  if (c?.certidoesFiscais) f.push(`Certidões fiscais consultadas automaticamente (Receita Federal, PGFN e FGTS): ${c.certidoesFiscais}.`);
  f.push('CNDT, CNIB e cartórios de protesto não são consultados automaticamente (exigem portal com captcha ou acesso pago) e constam como diligência do jurídico.');
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

const RESSALVA = 'Este material tem caráter informativo e de apoio à decisão. As informações provêm de anúncios públicos de terceiros, de documentos do próprio lote e de bases oficiais, e podem conter erros de origem ou estar desatualizadas na data da leitura. Não constitui laudo de avaliação nos termos da NBR 14653 nem parecer jurídico, e não substitui a vistoria presencial do imóvel, a leitura integral do edital e da matrícula atualizada, nem a orientação de profissional habilitado antes do lance.';

/**
 * Rodapé renderizado. `tipo`: 'mercadologico' | 'documental' | 'laudo' | 'indice'.
 * `dados`: o result (ou a região, no índice). Nunca quebra: sem metodologia, mostra a ressalva.
 */
export default function NotaMetodologica({ tipo, dados, extra, compacto = false }) {
  let frases = [];
  try {
    if (tipo === 'mercadologico') frases = frasesMercadologico(dados?.mercado || dados, dados?.divergenciaArea || extra);
    else if (tipo === 'documental') frases = frasesDocumental(dados);
    else if (tipo === 'laudo') frases = frasesLaudo(dados);
    else if (tipo === 'indice') frases = frasesIndice(dados, extra);
  } catch { frases = []; }
  const cor = '#94a3b8';
  return (
    <div style={{ marginTop: compacto ? 10 : 16, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: cor, marginBottom: 5 }}>
        Metodologia e ressalvas
      </div>
      <p style={{ fontSize: 9.5, lineHeight: 1.55, color: cor, margin: 0, textAlign: 'justify' }}>
        {frases.join(' ')} {RESSALVA}
      </p>
    </div>
  );
}

/** Mesma nota em TEXTO puro — para o PDF, que monta HTML por string. */
export function notaMetodologicaTexto(tipo, dados, extra) {
  let frases = [];
  try {
    if (tipo === 'mercadologico') frases = frasesMercadologico(dados?.mercado || dados, dados?.divergenciaArea || extra);
    else if (tipo === 'documental') frases = frasesDocumental(dados);
    else if (tipo === 'laudo') frases = frasesLaudo(dados);
    else if (tipo === 'indice') frases = frasesIndice(dados, extra);
  } catch { frases = []; }
  return `${frases.join(' ')} ${RESSALVA}`;
}
