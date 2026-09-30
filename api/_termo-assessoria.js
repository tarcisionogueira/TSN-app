// TERMO DE ASSESSORIA + PROCURAÇÃO PARTICULAR (30/09, pedido do dono).
//
// Por que existe: o termo de assessoria só nascia no CHECKOUT (R$ 6.000 / R$ 4.800 — api/auto-contrato.js).
// A arrematação ATRIBUÍDA pela equipe (api/atribuir-arremate.js, "contratou de fato") cobra só o
// honorário de êxito e não passava por checkout nenhum — ficava SEM termo e SEM procuração. Caso real:
// Marcos Araujo (assessorado desde 12/09) pagou R$ 54.835,52 de êxito em 17/09 e não havia nada
// assinado no sistema quando a equipe precisou dos dados dele para seguir com a arrematação.
//
// Regra do dono (30/09, refinada no mesmo dia): SÃO DOIS DOCUMENTOS. O TERMO de contratação da
// assessoria (por contratação: valor pago, a cobrar ou isento) e a PROCURAÇÃO PARTICULAR (por
// arrematação: autoriza a CONTRATADA a resolver as demandas daquela arrematação). Nunca juntos; na atribuída, o termo diz que os
// R$ 6.000 iniciais não são cobrados e a remuneração é só o êxito. Um texto só para os dois fluxos —
// o checkout importa daqui, para as duas versões não divergirem.
//
// VALORES SEMPRE DA CONFIGURAÇÃO (30/09): o texto antigo dizia R$ 4.800 à vista e mínimo de êxito
// R$ 5.000, enquanto planos_config/config_honorarios cobravam R$ 5.000 e R$ 7.000 — o contrato
// assinado dizia um preço e o sistema cobrava outro. Agora preço, à vista, % e mínimo vêm do banco.
//
// Sem dependência de supabase-js: roda no Edge (atribuir-arremate) e no Node (auto-contrato).

const BASE = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSESSORIA PARA ARREMATAÇÃO EM LEILÕES

CONTRATADA (ASSESSORIA): NOGUEIRA EMPREENDIMENTOS LTDA, inscrita no CNPJ nº 02.311.492/0001-61, com sede em Feira de Santana/BA, representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, brasileiro, empresário, inscrito no CPF nº 042.293.535-29.

CONTRATANTE (CLIENTE): [NOME DO SIGNATÁRIO], inscrito(a) no CPF/CNPJ nº [CPF/CNPJ DO SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO DO SIGNATÁRIO].

Pelo presente instrumento particular, as partes acima qualificadas celebram o presente Contrato de Prestação de Serviços de Assessoria, que se regerá pelas cláusulas e condições a seguir:

CLÁUSULA PRIMEIRA — DO OBJETO E ESCOPO
1.1. O objeto deste contrato é a prestação de serviços técnicos de assessoria e representação especializada para a aquisição de bens através de leilões (judiciais ou extrajudiciais) pela CONTRATADA em favor da CONTRATANTE, referente a 1 (um) imóvel, com prazo de até 12 (doze) meses a contar da assinatura para a conclusão da arrematação. Os serviços não incluem mentoria ou treinamento.
1.2. O escopo abrange: Triagem e Avaliação (análise técnica e jurídica preliminar dos editais, processos, débitos ocultos e viabilidade mercadológica, sugerindo oportunidades seguras); Habilitação (análise documental e cadastramento junto aos leiloeiros oficiais); Arremate (execução da estratégia de lances e representação no leilão); Resolução Processual (acompanhamento até a Carta de Arrematação); e Posse (diligências para a imissão na posse do bem).
1.3. No ato da imissão na posse, a CONTRATANTE deverá indicar representante próprio de sua confiança para acompanhar o Oficial de Justiça no recebimento do bem.
1.4. O acompanhamento presencial por especialista da CONTRATADA na imissão, se solicitado, gera custos adicionais (deslocamento, hospedagem e alimentação), arcados integralmente pela CONTRATANTE.

CLÁUSULA SEGUNDA — DAS EXCLUSÕES DE ESCOPO
2.1. Este contrato não cobre reforma, reparo, limpeza, modificação, transporte ou descaracterização do bem arrematado.
2.2. A entrega do bem dar-se-á no estado em que se encontra (cláusula ad corpus e "as is" inerente aos leilões); serviços físicos no bem constituem operação distinta, mediante nova contratação e orçamento à parte.

CLÁUSULA TERCEIRA — DA REMUNERAÇÃO E HONORÁRIOS
3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA, conforme a modalidade escolhida no ato da contratação: (a) R$ 6.000,00 (seis mil reais) parcelados em 12 (doze) parcelas mensais de R$ 500,00 (quinhentos reais); ou (b) R$ 4.800,00 (quatro mil e oitocentos reais) em pagamento único à vista, com 20% (vinte por cento) de desconto sobre o total parcelado. O pagamento é feito via PIX/cartão em favor da NOGUEIRA EMPREENDIMENTOS LTDA.
3.2. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de 10% (dez por cento) sobre o valor final da arrematação do bem, independentemente da modalidade de pagamento escolhida.
3.3. Fica estipulado o valor mínimo de R$ 5.000,00 (cinco mil reais) a título de honorários de êxito, caso o percentual de 10% resulte em montante inferior.
3.4. O pagamento dos honorários de êxito deverá ser feito de forma simultânea ao pagamento da comissão do leiloeiro e da arrematação, seja a aquisição à vista ou financiada/hipotecada/parcelada.
3.5. Os honorários não se confundem com a comissão do leiloeiro, custas processuais, taxas, impostos (ITBI, IPVA etc.) ou despesas de remoção, de exclusiva responsabilidade da CONTRATANTE.
3.6. Na modalidade hipotecada (parcelamento do leilão judicial), o escopo ordinário limita-se ao arremate e imissão na posse; o acompanhamento das parcelas mensais dependerá de profissional próprio da CONTRATANTE ou de contratação complementar com a CONTRATADA.
3.7. Todos os valores devidos no âmbito deste contrato — incluindo, sem limitação, os honorários de êxito de que tratam as Cláusulas 3.2 e 3.3 — deverão ser processados EXCLUSIVAMENTE pelos meios de pagamento disponibilizados na Plataforma BidPro Brasil, ainda que o beneficiário final do repasse seja a própria CONTRATADA.
3.8. O pagamento de qualquer valor devido no âmbito deste contrato por fora da Plataforma — diretamente à CONTRATADA, a prepostos, a terceiros ou por qualquer meio informal — configura, por si só, quebra contratual por tentativa de extravio de valores, autorizando a rescisão imediata por justa causa (nos termos da Cláusula 6.3) e eximindo a CONTRATADA de qualquer responsabilidade sobre a continuidade das etapas subsequentes do fluxo de arrematação, sem prejuízo da exigibilidade integral dos valores originalmente pactuados.

CLÁUSULA QUARTA — DO PRAZO E CANCELAMENTO
4.1. Este contrato vigorará por até 12 (doze) meses a contar da assinatura, prazo máximo para a conclusão da arrematação. Não havendo arrematação nesse período por razões imputáveis à CONTRATANTE, o contrato encerra-se sem devolução dos valores pagos.
4.2. A CONTRATANTE deverá assinar este instrumento em até 30 (trinta) dias a contar do envio do link de assinatura, sob pena de cancelamento do serviço e estorno do valor pago.
4.3. A rescisão imotivada por qualquer das partes, mediante aviso prévio de 30 (trinta) dias, sujeita a parte que lhe der causa à multa de 10% (dez por cento) sobre o valor total do contrato.

CLÁUSULA QUINTA — DOS RISCOS INERENTES AOS LEILÕES
5.1. A CONTRATANTE tem ciência de que arrematações em leilões, sobretudo judiciais, têm natureza resolúvel e estão sujeitas a contestações, embargos ou recursos de terceiros (Art. 903 do CPC), podendo o leilão ser suspenso, invalidado ou cancelado por decisão judicial superveniente.
5.2. A CONTRATADA atua com rigor técnico na triagem e análise de riscos (curadoria); o cancelamento por fatos alheios à sua atuação diligente é risco inerente ao negócio e não configura falha na prestação do serviço.
5.3. Cancelada, desfeita ou invalidada a arrematação por decisão judicial ou administrativa após o arremate, sem dolo ou culpa comprovada da CONTRATADA, os serviços de habilitação, estratégia, representação, arremate e acompanhamento inicial serão considerados efetivamente prestados.

CLÁUSULA SEXTA — DA ANTICORRUPÇÃO E DA PREVENÇÃO À LAVAGEM DE DINHEIRO
6.1. As Partes conhecem e cumprem a Lei nº 12.846/2013 (Anticorrupção), comprometendo-se a não praticar suborno, fraude ou oferta de vantagem indevida a agentes públicos, juízes, leiloeiros ou terceiros.
6.2. A CONTRATANTE cumpre as normas de prevenção à lavagem de dinheiro (Lei nº 9.613/1998) e atesta, sob as penas da lei, que todos os recursos utilizados na operação (lance, comissão, taxas, impostos e honorários) têm origem lícita e declarada, obrigando-se a comprová-la sempre que solicitado.
6.3. A violação a esta cláusula autoriza a rescisão imediata por justa causa, sem devolução de valores pagos, com honorários devidos integralmente e comunicação aos órgãos competentes (COAF, Ministério Público).

CLÁUSULA SÉTIMA — DA CONFIDENCIALIDADE, PROPRIEDADE INTELECTUAL E LGPD
7.1. As estratégias de arrematação e análises jurídicas da CONTRATADA são protegidas por sigilo profissional e direitos intelectuais.
7.2. As Partes observam a Lei nº 13.709/2018 (LGPD), resguardando as informações financeiras e pessoais trocadas na operação, limitadas ao estritamente necessário para a execução dos serviços.

CLÁUSULA OITAVA — DO FORO
8.1. As Partes elegem o foro da Comarca de Feira de Santana/BA para dirimir controvérsias, renunciando a qualquer outro por mais privilegiado que seja.

E, por estarem justas e contratadas, as partes assinam o presente instrumento digitalmente, com apontamento de testemunha. Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.

CONTRATADA: NOGUEIRA EMPREENDIMENTOS LTDA — CNPJ 02.311.492/0001-61

CONTRATANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]`;

const brl = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null);
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const ORIGIN = () => process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

// Valores do termo lidos do banco (planos_config 'assessorado' + config_honorarios). `sb` = fetch
// REST com service key. Falha de leitura NÃO vira preço inventado: devolve null e quem chama recusa.
export async function precosAssessoria(sb) {
  const [rP, rH] = await Promise.all([
    sb('planos_config?plano_key=eq.assessorado&select=preco,preco_vista&limit=1'),
    sb('config_honorarios?id=eq.1&select=total_pct,honorario_minimo'),
  ]);
  if (!rP.ok || !rH.ok) return null;
  const [p] = await rP.json(); const [h] = await rH.json();
  if (!(Number(p?.preco) > 0)) return null;
  return { parcelado: Number(p.preco), vista: Number(p.preco_vista) || null, pct: Number(h?.total_pct) || 10, minimo: Number(h?.honorario_minimo) || null };
}

// isento · a cobrar (parcelado/vista → cobrança avulsa) · já pago (parcelado_pago/vista_pago → só registra)
export const TAXAS_INICIAIS = ['isento', 'parcelado', 'vista', 'parcelado_pago', 'vista_pago'];

/**
 * TERMO DE CONTRATAÇÃO DA ASSESSORIA. Sem `atribuido` = texto do CHECKOUT. Com `atribuido`
 * ({ taxaInicial, pagoEm?, imovel?: {descricao, processo, valor}, honorarios?: {valor, pagoEm} }) =
 * contratação registrada pela equipe. `precos` é OBRIGATÓRIO (contrato com preço diferente do
 * cobrado é pior que nenhum).
 */
export function termoAssessoria(precos, atribuido = null) {
  if (!precos?.parcelado) throw new Error('termoAssessoria: preços da configuração ausentes');
  const parcela = brl(precos.parcelado / 12);
  const opcaoVista = precos.vista ? `; ou (b) ${brl(precos.vista)} em pagamento único à vista` : '';
  let t = BASE
    .replace(/^3\.1\. [^\n]*$/m, `3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA, conforme a modalidade escolhida no ato da contratação: (a) ${brl(precos.parcelado)} parcelados em 12 (doze) parcelas mensais de ${parcela}${opcaoVista}. O pagamento é feito pelos meios da Plataforma BidPro Brasil, em favor da NOGUEIRA EMPREENDIMENTOS LTDA.`)
    .replace(/^3\.2\. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de 10% \(dez por cento\)/m, `3.2. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de ${precos.pct}%`)
    .replace(/^3\.3\. [^\n]*$/m, precos.minimo ? `3.3. Fica estipulado o valor mínimo de ${brl(precos.minimo)} a título de honorários de êxito, caso o percentual resulte em montante inferior.` : '$&');
  if (!atribuido) return t;

  const taxa = TAXAS_INICIAIS.includes(atribuido.taxaInicial) ? atribuido.taxaInicial : 'isento';
  const hon = atribuido.honorarios || {};
  const exito = brl(hon.valor) ? ` O honorário de êxito da arrematação vinculada soma ${brl(hon.valor)}${hon.pagoEm ? `, já quitados em ${dataBR(hon.pagoEm)}` : ', a serem pagos pela Plataforma nos termos da Cláusula 3.4'}.` : '';
  const quitado = atribuido.pagoEm ? `, valor já QUITADO em ${dataBR(atribuido.pagoEm)}` : ', valor já QUITADO pela CONTRATANTE';
  const c31 = {
    isento: `3.1. Por decisão da CONTRATADA nesta contratação, a CONTRATANTE fica ISENTA dos serviços iniciais de assessoria (${brl(precos.parcelado)} parcelados${precos.vista ? ` ou ${brl(precos.vista)} à vista` : ''}). A remuneração da CONTRATADA é exclusivamente o honorário de êxito das Cláusulas 3.2 e 3.3.${exito}`,
    parcelado: `3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA ${brl(precos.parcelado)}, podendo parcelar em até 12 (doze) vezes de ${parcela} no cartão, pelo link de pagamento da Plataforma BidPro Brasil, além do honorário de êxito das Cláusulas 3.2 e 3.3.${exito}`,
    vista: `3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA ${brl(precos.vista)} em pagamento único à vista, pelo link de pagamento da Plataforma BidPro Brasil, além do honorário de êxito das Cláusulas 3.2 e 3.3.${exito}`,
    parcelado_pago: `3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagou à CONTRATADA ${brl(precos.parcelado)} na modalidade parcelada${quitado}, além do honorário de êxito das Cláusulas 3.2 e 3.3.${exito}`,
    vista_pago: `3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagou à CONTRATADA ${brl(atribuido.valorPago || precos.vista)} em pagamento único à vista${quitado}, além do honorário de êxito das Cláusulas 3.2 e 3.3.${exito}`,
  }[taxa];
  const im = atribuido.imovel;
  return t
    .replace(/^1\.1\. /m, im ? `1.0. Esta contratação refere-se ao imóvel ${im.descricao}${im.processo ? `, processo nº ${im.processo}` : ''}${im.valor ? `, arrematado por ${im.valor}` : ''}.\n1.1. ` : '1.1. ')
    .replace(/^3\.1\. [^\n]*$/m, c31)
    .replace(/^4\.2\. [^\n]*$/m, '4.2. A CONTRATANTE deverá assinar este instrumento em até 30 (trinta) dias a contar do envio do link de assinatura; até a assinatura, o acompanhamento pela Plataforma fica suspenso.');
}

/**
 * PROCURAÇÃO PARTICULAR — documento PRÓPRIO, por arrematação (dono, 30/09: "a procuração autoriza
 * resolver as demandas da arrematação em questão"). Cobre a arrematação a realizar (habilitação e
 * lances só até o limite autorizado por escrito) e a realizada (auto/carta, registro, posse). Nunca
 * dispor do bem nem receber dinheiro do cliente.
 */
export function procuracaoArrematacao(nome, imovel) {
  const objeto = `à arrematação, realizada ou a realizar, do imóvel ${imovel.descricao}${imovel.processo ? `, processo nº ${imovel.processo}` : ''}${imovel.leiloeiro ? `, leiloeiro(a) ${imovel.leiloeiro}` : ''}${imovel.valor ? `, arrematado por ${imovel.valor}` : ''}`;
  return `PROCURAÇÃO PARTICULAR

OUTORGANTE: ${nome || '[NOME DO SIGNATÁRIO]'}, inscrito(a) no CPF/CNPJ nº [CPF/CNPJ DO SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO DO SIGNATÁRIO].

OUTORGADA: NOGUEIRA EMPREENDIMENTOS LTDA, inscrita no CNPJ nº 02.311.492/0001-61, com sede em Feira de Santana/BA, neste ato representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, CPF nº 042.293.535-29.

1. OBJETO. Pelo presente instrumento particular, a OUTORGANTE nomeia e constitui a OUTORGADA sua bastante procuradora e responsável pela condução das demandas relativas, especificamente, ${objeto}.

2. ANTES DO ARREMATE, a OUTORGADA poderá: cadastrar e habilitar a OUTORGANTE junto ao leiloeiro e à plataforma do leilão, enviando os documentos por ela fornecidos; participar do leilão e ofertar lances em nome da OUTORGANTE, SEMPRE dentro do valor máximo que a OUTORGANTE autorizar por escrito (mensagem ou e-mail registrado) — lance acima desse limite não é autorizado por esta procuração.

3. DEPOIS DO ARREMATE, a OUTORGADA poderá representá-la perante o leiloeiro, o comitente vendedor, o juízo e a secretaria do processo (nos atos que não sejam privativos de advogado), cartórios de registro de imóveis e de notas, prefeituras, secretarias de fazenda, concessionárias de serviço público, condomínio e demais órgãos públicos e privados, podendo: requerer, retirar e protocolar certidões, guias (inclusive de ITBI), requerimentos e documentos; acompanhar a expedição do auto/carta de arrematação e o respectivo registro; prestar e obter informações; acompanhar as diligências de imissão na posse; e praticar os demais atos necessários à conclusão da arrematação.

4. VEDAÇÕES. São VEDADOS à OUTORGADA: receber ou dar quitação de valores em nome da OUTORGANTE, pagar lance, comissão ou tributos com recursos próprios em nome dela, alienar, onerar ou prometer o bem, e substabelecer sem anuência expressa da OUTORGANTE. Atos privativos de advocacia serão praticados por advogado constituído.

5. FORMA E VIGÊNCIA. Procuração particular, sem registro ou reconhecimento de firma em cartório, válida pela assinatura eletrônica (MP 2.200-2/2001 e Lei 14.063/2020), vigente até a conclusão da arrematação e do registro do bem, ou até revogação expressa da OUTORGANTE. Se algum órgão exigir firma reconhecida ou instrumento público para ato específico, a OUTORGANTE se obriga a providenciá-lo em até 5 (cinco) dias úteis da solicitação.

OUTORGANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]`;
}

// ── Leitura de apoio comum ────────────────────────────────────────────────────────────────
async function dadosDoCaso(sb, { casoId, arrematacaoId }) {
  let a = null;
  if (arrematacaoId) {
    const rA = await sb(`arrematacoes?id=eq.${encodeURIComponent(arrematacaoId)}&select=id,cliente_id,imovel_id,caso_id,valor_arrematado,honorarios_valor,honorarios_pago_em,numero_processo,leiloeiro&limit=1`);
    if (!rA.ok) throw new Error(`leitura da arrematação HTTP ${rA.status}`);
    [a] = await rA.json();
    if (!a) throw new Error('arrematação não encontrada');
    casoId = casoId || a.caso_id;
  }
  if (!casoId) return { caso: null, a, im: null };
  const rC = await sb(`casos?id=eq.${encodeURIComponent(casoId)}&select=id,cliente_id,imovel_id,imovel_endereco&limit=1`);
  if (!rC.ok) throw new Error(`leitura do caso HTTP ${rC.status}`);
  const [caso] = await rC.json();
  if (!caso) throw new Error('caso não encontrado');
  if (!a) {
    const rA2 = await sb(`arrematacoes?caso_id=eq.${caso.id}&select=id,cliente_id,imovel_id,caso_id,valor_arrematado,honorarios_valor,honorarios_pago_em,numero_processo,leiloeiro&limit=1`);
    if (rA2.ok) [a] = await rA2.json();
  }
  const imovelId = a?.imovel_id || caso.imovel_id;
  let im = null;
  if (imovelId) {
    const rI = await sb(`imoveis_leilao?id=eq.${imovelId}&select=id,titulo,endereco,cidade,estado,numero_processo,leiloeiro&limit=1`);
    if (!rI.ok) throw new Error(`leitura do imóvel HTTP ${rI.status}`);
    [im] = await rI.json();
  }
  return { caso, a, im };
}

function descricaoImovel(caso, a, im) {
  const endereco = [im?.endereco, im?.cidade && `${im.cidade}${im.estado ? `/${im.estado}` : ''}`].filter(Boolean).join(', ');
  const titulo = im?.titulo || caso?.imovel_endereco;
  if (!titulo) return null;
  return {
    descricao: `"${titulo}"${endereco ? ` (${endereco})` : ''}`,
    processo: a?.numero_processo || im?.numero_processo || null,
    leiloeiro: a?.leiloeiro || im?.leiloeiro || null,
    valor: brl(a?.valor_arrematado),
  };
}

async function nomeDo(sb, userId) {
  const r = await sb(`perfis?id=eq.${userId}&select=nome&limit=1`);
  if (!r.ok) throw new Error(`leitura do perfil HTTP ${r.status}`);
  const [p] = await r.json();
  return p?.nome || null;
}

// Cria o link de assinatura + o contrato pendente (bloqueio até assinar). Idempotente por
// (produto_tipo, produto_id) entre os que estão aguardando ou assinados.
async function criarDocumento(sb, { userId, titulo, conteudo, produtoTipo, produtoId, planoKey, imovelId, criadoPor }) {
  const rJa = await sb(`contratos_link?produto_tipo=eq.${produtoTipo}&produto_id=eq.${encodeURIComponent(produtoId)}&arremate_user_id=eq.${userId}&status=in.(aguardando_assinatura,assinado)&select=token,status&limit=1`);
  if (!rJa.ok) return { ok: false, motivo: `conferência de documento existente HTTP ${rJa.status}` };
  const [ja] = await rJa.json();
  if (ja) return { ok: true, jaExistia: true, status: ja.status, url: `${ORIGIN()}#/c/${ja.token}` };
  const rL = await sb('contratos_link', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      titulo, conteudo, tipo_contrato: 'servico', status: 'aguardando_assinatura', requer_assinatura: true,
      criado_por: criadoPor, plano_key: planoKey || null, produto_tipo: produtoTipo, produto_id: String(produtoId),
      arremate_imovel_id: imovelId || null, arremate_user_id: userId,
      // KYC do termo do checkout: selfie + foto do documento compõem a prova de autoria
      kyc_incluido: true, verificacao_identidade: 'selfie', docs_extras_exigidos: ['foto_doc'],
    }),
  });
  if (!rL.ok) return { ok: false, motivo: `criação do documento HTTP ${rL.status}: ${(await rL.text().catch(() => '')).slice(0, 120)}` };
  const [link] = await rL.json();
  if (!link?.id) return { ok: false, motivo: 'documento não voltou do banco' };
  // UPSERT: um documento refeito (o anterior cancelado) cairia na chave única (user, tipo, produto)
  // e o novo ficava SEM bloqueio — visto no Marcos em 30/09. O registro passa a apontar o novo link.
  const rPend = await sb('contratos_pendentes?on_conflict=user_id,produto_tipo,produto_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, produto_tipo: produtoTipo, produto_id: String(produtoId), contrato_link_id: link.id,
      status: 'aguardando', expira_em: new Date(Date.now() + 30 * 86400000).toISOString() }),
  });
  return { ok: true, url: `${ORIGIN()}#/c/${link.token}`, ...(rPend.ok ? {} : { aviso: `documento criado, mas o bloqueio até a assinatura falhou (HTTP ${rPend.status})` }) };
}

/**
 * TERMO DE CONTRATAÇÃO da assessoria registrado pela equipe. Uma contratação = um termo: o cliente
 * com duas assessorias tem dois (`referencia` distingue: id do caso, ou um rótulo como "2"). Quando a
 * taxa é a cobrar, cria a cobrança avulsa (preço do servidor). Nunca lança.
 */
export async function gerarTermoAssessoria(sb, { userId = null, casoId = null, arrematacaoId = null, referencia = null, taxaInicial = 'isento', pagoEm = null, valorPago = null, criadoPor = null }) {
  try {
    const { caso, a, im } = await dadosDoCaso(sb, { casoId, arrematacaoId });
    const uid = userId || caso?.cliente_id;
    if (!uid) return { ok: false, motivo: 'cliente não informado' };
    const precos = await precosAssessoria(sb);
    if (!precos) return { ok: false, motivo: 'não consegui ler os preços da assessoria (planos_config/config_honorarios)' };
    const taxa = TAXAS_INICIAIS.includes(taxaInicial) ? taxaInicial : null;
    if (!taxa) return { ok: false, motivo: `taxa inicial deve ser ${TAXAS_INICIAIS.join(' | ')}` };
    if (taxa === 'vista' && !precos.vista) return { ok: false, motivo: 'planos_config sem preco_vista para a assessoria' };
    const nome = await nomeDo(sb, uid);
    const conteudo = termoAssessoria(precos, {
      taxaInicial: taxa, pagoEm, valorPago,
      imovel: descricaoImovel(caso, a, im),
      honorarios: a ? { valor: a.honorarios_valor, pagoEm: a.honorarios_pago_em } : {},
    }).replace(/\[NOME DO SIGNATÁRIO\]/gi, nome || '[NOME DO SIGNATÁRIO]').replace(/\[NOME\]/gi, nome || '[NOME]');

    let cobrancaUrl = null;
    if (taxa === 'parcelado' || taxa === 'vista') {
      const rCob = await sb('cobrancas_avulsas', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          descricao: `Assessoria BidPro — serviços iniciais (${taxa === 'vista' ? 'à vista' : 'até 12x no cartão'}) · ${nome || 'cliente'}`.slice(0, 500),
          valor: taxa === 'vista' ? precos.vista : precos.parcelado, destinatario_nome: nome, criado_por: criadoPor,
        }),
      });
      if (!rCob.ok) return { ok: false, motivo: `cobrança da taxa inicial não foi criada (HTTP ${rCob.status}) — termo NÃO gerado para não citar cobrança inexistente` };
      const [cob] = await rCob.json();
      cobrancaUrl = cob?.id ? `${ORIGIN()}/#/cobranca/${cob.id}` : null;
    }
    const r = await criarDocumento(sb, {
      userId: uid, titulo: 'Termo de Contratação da Assessoria', conteudo, produtoTipo: 'assessoria',
      produtoId: caso?.id || `${uid}:${referencia || '1'}`, planoKey: 'assessorado', imovelId: im?.id || null, criadoPor,
    });
    return { ...r, cobrancaUrl };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 160) };
  }
}

/** PROCURAÇÃO PARTICULAR de uma arrematação (caso). Sem plano_key: não mexe em papel nem assinatura. Nunca lança. */
export async function gerarProcuracao(sb, { casoId = null, arrematacaoId = null, criadoPor = null }) {
  try {
    const { caso, a, im } = await dadosDoCaso(sb, { casoId, arrematacaoId });
    if (!caso) return { ok: false, motivo: 'procuração exige o caso/arrematação' };
    const imovel = descricaoImovel(caso, a, im);
    if (!imovel) return { ok: false, motivo: 'caso sem imóvel identificado — a procuração precisa dizer qual arrematação' };
    const nome = await nomeDo(sb, caso.cliente_id);
    return await criarDocumento(sb, {
      userId: caso.cliente_id, titulo: 'Procuração Particular — Arrematação', conteudo: procuracaoArrematacao(nome, imovel),
      produtoTipo: 'arrematacao', produtoId: caso.id, planoKey: null, imovelId: im?.id || null, criadoPor,
    });
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 160) };
  }
}
