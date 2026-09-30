// TERMO DE ASSESSORIA + PROCURAÇÃO PARTICULAR (30/09, pedido do dono).
//
// Por que existe: o termo de assessoria só nascia no CHECKOUT (R$ 6.000 / R$ 4.800 — api/auto-contrato.js).
// A arrematação ATRIBUÍDA pela equipe (api/atribuir-arremate.js, "contratou de fato") cobra só o
// honorário de êxito e não passava por checkout nenhum — ficava SEM termo e SEM procuração. Caso real:
// Marcos Araujo (assessorado desde 12/09) pagou R$ 54.835,52 de êxito em 17/09 e não havia nada
// assinado no sistema quando a equipe precisou dos dados dele para seguir com a arrematação.
//
// Regra do dono: todo termo de assessoria vem com PROCURAÇÃO PARTICULAR (sem registro em cartório)
// autorizando a CONTRATADA a resolver a arrematação contratada; na atribuída, o termo diz que os
// R$ 6.000 iniciais não são cobrados e a remuneração é só o êxito. Um texto só para os dois fluxos —
// o checkout importa daqui, para as duas versões não divergirem.
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

[[PROCURACAO]]

E, por estarem justas e contratadas, as partes assinam o presente instrumento digitalmente, com apontamento de testemunha. Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.

CONTRATADA: NOGUEIRA EMPREENDIMENTOS LTDA — CNPJ 02.311.492/0001-61

CONTRATANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]`;

const brl = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null);

// Procuração particular — poderes para RESOLVER a arrematação, nunca para dispor do bem ou receber
// dinheiro do cliente. Atos privativos de advogado ficam com o advogado constituído.
function procuracao(imovel) {
  const objeto = imovel
    ? `a arrematação do imóvel ${imovel.descricao}${imovel.processo ? `, processo nº ${imovel.processo}` : ''}${imovel.leiloeiro ? `, leiloeiro(a) ${imovel.leiloeiro}` : ''}${imovel.valor ? `, arrematado por ${imovel.valor}` : ''}`
    : 'a(s) arrematação(ões) realizada(s) no âmbito deste contrato';
  return `CLÁUSULA NONA — DA PROCURAÇÃO PARTICULAR
9.1. Pelo presente instrumento, e na mesma assinatura eletrônica deste contrato, a CONTRATANTE (OUTORGANTE), qualificada no preâmbulo, nomeia e constitui sua bastante procuradora a CONTRATADA (OUTORGADA), NOGUEIRA EMPREENDIMENTOS LTDA, CNPJ nº 02.311.492/0001-61, neste ato representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, CPF nº 042.293.535-29, para, especificamente quanto a ${objeto}, representá-la perante o leiloeiro, o comitente vendedor, o juízo e a secretaria do processo (nos atos que não sejam privativos de advogado), cartórios de registro de imóveis e de notas, prefeituras, secretarias de fazenda, concessionárias de serviço público, condomínio e demais órgãos públicos e privados, podendo: requerer, retirar e protocolar certidões, guias (inclusive de ITBI), requerimentos e documentos; acompanhar a expedição do auto/carta de arrematação e o respectivo registro; prestar e obter informações; acompanhar as diligências de imissão na posse; e praticar os demais atos necessários à conclusão da arrematação.
9.2. São VEDADOS à OUTORGADA: receber ou dar quitação de valores em nome da OUTORGANTE, alienar, onerar ou prometer o bem, e substabelecer sem anuência expressa da OUTORGANTE. Atos privativos de advocacia serão praticados por advogado constituído.
9.3. Procuração particular, sem registro ou reconhecimento de firma em cartório, válida pela assinatura eletrônica (MP 2.200-2/2001 e Lei 14.063/2020), vigente até a conclusão da arrematação e do registro do bem, no máximo pelo prazo deste contrato. Se algum órgão exigir firma reconhecida ou instrumento público para ato específico, a OUTORGANTE se obriga a providenciá-lo em até 5 (cinco) dias úteis da solicitação.`;
}

/**
 * Texto do termo. Sem argumentos = o termo do CHECKOUT (R$ 6.000/R$ 4.800), agora com a procuração.
 * `atribuido` = arrematação atribuída pela equipe: { imovel: {descricao, processo, leiloeiro, valor},
 * honorarios: {valor, pagoEm}, minimo, pct }.
 */
export function termoAssessoria(atribuido = null) {
  let t = BASE.replace('[[PROCURACAO]]', procuracao(atribuido?.imovel || null));
  if (!atribuido) return t;
  const hon = atribuido.honorarios || {};
  const minimo = brl(atribuido.minimo) || 'R$ 7.000,00';
  const pct = Number(atribuido.pct) || 10;
  const situacao = hon.pagoEm
    ? `, já quitados em ${new Date(hon.pagoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    : ', a serem pagos pela Plataforma nos termos da Cláusula 3.4';
  t = t
    .replace(/^1\.1\. /m, `1.0. Este instrumento formaliza a assessoria prestada na arrematação ATRIBUÍDA à CONTRATANTE: ${atribuido.imovel.descricao}${atribuido.imovel.processo ? `, processo nº ${atribuido.imovel.processo}` : ''}${atribuido.imovel.valor ? `, valor da arrematação ${atribuido.imovel.valor}` : ''}.\n1.1. `)
    .replace(/^3\.1\. [^\n]*$/m, `3.1. Por se tratar de arrematação atribuída pela CONTRATADA, NÃO são cobrados os serviços iniciais de assessoria (R$ 6.000,00 parcelados ou R$ 4.800,00 à vista). A remuneração da CONTRATADA é exclusivamente o honorário de êxito das Cláusulas 3.2 e 3.3${brl(hon.valor) ? `, que nesta arrematação soma ${brl(hon.valor)}${situacao}` : ''}.`)
    .replace(/^3\.2\. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de 10% \(dez por cento\)/m, `3.2. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de ${pct}%`)
    .replace(/^3\.3\. [^\n]*$/m, `3.3. Fica estipulado o valor mínimo de ${minimo} a título de honorários de êxito, caso o percentual resulte em montante inferior.`)
    .replace(/^4\.2\. [^\n]*$/m, '4.2. A CONTRATANTE deverá assinar este instrumento em até 30 (trinta) dias a contar do envio do link de assinatura; até a assinatura, o acompanhamento da arrematação pela Plataforma fica suspenso.');
  return t;
}

/**
 * Gera (idempotente) o termo da arrematação ATRIBUÍDA e o contrato pendente que bloqueia a
 * plataforma até a assinatura (lido por ContratoObrigatorio). `sb(path, opts)` = fetch REST com a
 * service key. Devolve { ok, token?, url?, jaExistia?, motivo? } — nunca lança.
 */
export async function gerarTermoAtribuido(sb, { arrematacaoId, criadoPor = null }) {
  try {
    const rA = await sb(`arrematacoes?id=eq.${encodeURIComponent(arrematacaoId)}&select=id,cliente_id,imovel_id,caso_id,valor_arrematado,honorarios_valor,honorarios_pago_em,numero_processo,leiloeiro&limit=1`);
    if (!rA.ok) return { ok: false, motivo: `leitura da arrematação HTTP ${rA.status}` };
    const [a] = await rA.json();
    if (!a?.cliente_id) return { ok: false, motivo: 'arrematação não encontrada' };

    // Idempotência: um termo por arrematação (aguardando OU assinado).
    const rJa = await sb(`contratos_link?produto_tipo=eq.arrematacao&produto_id=eq.${a.id}&status=in.(aguardando_assinatura,assinado)&select=token,status&limit=1`);
    if (!rJa.ok) return { ok: false, motivo: `conferência de termo existente HTTP ${rJa.status}` };
    const [ja] = await rJa.json();
    const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
    if (ja) return { ok: true, jaExistia: true, status: ja.status, token: ja.token, url: `${origin}#/c/${ja.token}` };

    const [rP, rI, rC, rCfg] = await Promise.all([
      sb(`perfis?id=eq.${a.cliente_id}&select=nome&limit=1`),
      a.imovel_id ? sb(`imoveis_leilao?id=eq.${a.imovel_id}&select=titulo,endereco,cidade,estado,numero_processo,leiloeiro&limit=1`) : null,
      a.caso_id ? sb(`casos?id=eq.${a.caso_id}&select=imovel_endereco&limit=1`) : null,
      sb('config_honorarios?id=eq.1&select=total_pct,honorario_minimo'),
    ]);
    for (const r of [rP, rI, rC, rCfg]) if (r && !r.ok) return { ok: false, motivo: `leitura de apoio HTTP ${r.status}` };
    const [perfil] = await rP.json();
    const [im] = rI ? await rI.json() : [];
    const [caso] = rC ? await rC.json() : [];
    const [cfg] = await rCfg.json();

    const endereco = [im?.endereco, im?.cidade && `${im.cidade}${im.estado ? `/${im.estado}` : ''}`].filter(Boolean).join(', ');
    const titulo = im?.titulo || caso?.imovel_endereco || 'imóvel objeto da arrematação';
    const conteudo = termoAssessoria({
      imovel: {
        descricao: `"${titulo}"${endereco ? ` (${endereco})` : ''}`,
        processo: a.numero_processo || im?.numero_processo || null,
        leiloeiro: a.leiloeiro || im?.leiloeiro || null,
        valor: brl(a.valor_arrematado),
      },
      honorarios: { valor: a.honorarios_valor, pagoEm: a.honorarios_pago_em },
      minimo: cfg?.honorario_minimo, pct: cfg?.total_pct,
    }).replace(/\[NOME DO SIGNATÁRIO\]/gi, perfil?.nome || '[NOME DO SIGNATÁRIO]').replace(/\[NOME\]/gi, perfil?.nome || '[NOME]');

    const rL = await sb('contratos_link', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        titulo: 'Termo de Assessoria e Procuração — Arrematação Atribuída',
        conteudo, tipo_contrato: 'servico', status: 'aguardando_assinatura', requer_assinatura: true,
        criado_por: criadoPor, plano_key: 'assessorado', produto_tipo: 'arrematacao', produto_id: a.id,
        arremate_imovel_id: a.imovel_id || null, arremate_user_id: a.cliente_id,
        // mesmo KYC do termo do checkout: selfie + foto do documento compõem a prova de autoria
        kyc_incluido: true, verificacao_identidade: 'selfie', docs_extras_exigidos: ['foto_doc'],
      }),
    });
    if (!rL.ok) return { ok: false, motivo: `criação do termo HTTP ${rL.status}: ${(await rL.text().catch(() => '')).slice(0, 120)}` };
    const [link] = await rL.json();
    if (!link?.id) return { ok: false, motivo: 'termo não voltou do banco' };

    // Contrato pendente = a plataforma bloqueia até a assinatura (30 dias de aviso, depois tela cheia).
    const rPend = await sb('contratos_pendentes', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: a.cliente_id, produto_tipo: 'arrematacao', produto_id: a.id, contrato_link_id: link.id,
        status: 'aguardando', expira_em: new Date(Date.now() + 30 * 86400000).toISOString() }),
    });
    const pend = rPend.ok ? await rPend.json().catch(() => []) : [];
    return { ok: true, token: link.token, url: `${origin}#/c/${link.token}`, pendenteCriado: Array.isArray(pend) && pend.length > 0,
      ...(rPend.ok ? {} : { aviso: `termo criado, mas o bloqueio até a assinatura falhou (HTTP ${rPend.status})` }) };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 160) };
  }
}
