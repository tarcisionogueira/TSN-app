/**
 * Distribuição do êxito (honorários de arrematação) — modelo POR USUÁRIO.
 *
 * Cada membro da equipe pode ter um % de êxito individual
 * (perfis.honorario_exito_pct); NULL usa o padrão do papel (config_honorarios).
 * O ADMIN sempre EQUILIBRA: admin = total − soma dos envolvidos. Papel sem pessoa
 * designada não é subtraído, então a fatia dele fica com o admin (backup).
 *
 * Como o cálculo lê o % vigente no momento em que roda, ele só vale para vendas
 * finalizadas DEPOIS de qualquer mudança — arremates já distribuídos nunca são
 * recalculados (o chamador guarda um snapshot em arrematacoes.honorarios_split).
 *
 * Compartilhado entre api/arrematacoes.js (distribui) e api/honorarios-split.js
 * (monitora/prévia). Recebe um `db(path, opts)` do chamador para reaproveitar a
 * mesma camada REST/credencial.
 */

// Projeta a distribuição de UMA arrematação a partir do estado ATUAL.
// `db` → função REST (retorna { data }). `arr` → linha de arrematacoes.
export async function calcularDistribuicao(db, arr) {
  const valor = Number(arr.valor_arrematado || 0);
  const cfg = (await db('config_honorarios?id=eq.1&select=total_pct,admin_pct,advogado_pct,analista_pct,consultor_pct')).data?.[0]
    || { total_pct: 10, admin_pct: 4.5, advogado_pct: 5, analista_pct: 0.5, consultor_pct: 0 };
  const total = Number(cfg.total_pct) || 10;
  const adminRow = (await db('perfis?role=eq.admin&ativo=eq.true&select=id,nome&order=criado_em.asc&limit=1')).data?.[0];

  // Envolvidos designados no fluxo daquele cliente.
  const advogadoId = arr.advogado_id || null;
  const analistaId = arr.analista_id || null;
  // O INDICANTE DO CLIENTE (28/08). Antes, só entrava quem tivesse papel `consultor` — ou
  // seja, equipe interna. Parceiro comum (explorador, Investidor Pro) trazia o cliente, o
  // cliente arrematava, e o parceiro não participava do êxito: a regra do dono é que QUALQUER
  // parceiro recebe, com as mesmas condições dos outros fluxos.
  //
  // O gate é o MESMO de `distribuir_comissao_rede` (aceite do Programa + ativo + adimplente),
  // e não é burocracia: sem `parceiro_aceite_em` não há termo aceito, e pagar comissão a quem
  // não aderiu ao Programa é repasse sem contrato.
  //
  // O ADVOGADO PODE SER O INDICANTE, e acumula (regra do dono): quem trouxe o cliente E conduz
  // o jurídico do caso leva as duas fatias. Só o ADMIN fica de fora — a fatia da plataforma já
  // é dele, e somar a do parceiro seria pagar-se duas vezes pelo mesmo valor. Note que ele
  // acumula porque cumpre as DUAS condições: aceitou o termo do jurídico (para conduzir) e o
  // do parceiro (para indicar). Sem o segundo aceite, não leva a segunda fatia.
  let   consultorId = null;
  if (arr.arrematante_id) {
    const cli = (await db(`perfis?id=eq.${arr.arrematante_id}&select=indicado_por`)).data?.[0];
    if (cli?.indicado_por) {
      const ind = (await db(`perfis?id=eq.${cli.indicado_por}&select=id,role,ativo,parceiro_aceite_em,inadimplente_desde,plano_vencimento`)).data?.[0];
      const hoje = new Date().toISOString().slice(0, 10);
      const elegivel = ind
        && ind.ativo !== false
        && !!ind.parceiro_aceite_em
        && !ind.inadimplente_desde
        && (!ind.plano_vencimento || ind.plano_vencimento >= hoje)
        && ind.role !== 'admin';
      if (elegivel) consultorId = ind.id;
    }
  }

  // % efetivo = override individual do perfil OU padrão do papel.
  const ids = [advogadoId, analistaId, consultorId].filter(Boolean);
  const perfis = {};
  if (ids.length) {
    const rows = (await db(`perfis?id=in.(${ids.join(',')})&select=id,nome,honorario_exito_pct`)).data || [];
    for (const p of rows) perfis[p.id] = p;
  }
  const pctDe = (uid, papelPct) => {
    const ov = perfis[uid]?.honorario_exito_pct;
    return ov == null || ov === '' ? (Number(papelPct) || 0) : Math.max(0, Number(ov) || 0);
  };

  // ── A DIVISÃO É PROPORCIONAL, NÃO UM NÚMERO FIXO (28/08, regra do dono) ─────────────────
  // "Jurídico e plataforma dividem meio a meio o que sobra depois do parceiro."
  //   com parceiro:  parceiro 1,0 → restam 9,0 → jurídico 4,5 · plataforma 4,5
  //   sem parceiro:  parceiro 0   → restam 10  → jurídico 5,0 · plataforma 5,0
  //
  // Por isso `advogado_pct` NÃO pode ser lido direto da config como valor fixo: gravado 4,5, o
  // caso sem parceiro daria jurídico 4,5 e plataforma 5,5 — o desconto do parceiro sairia
  // inteiro do bolso do jurídico mesmo quando não há parceiro nenhum para descontar.
  //
  // ⚠️ CONSEQUÊNCIA: `config_honorarios.advogado_pct` e `.admin_pct` deixam de ser LIDOS — o
  // padrão do jurídico é calculado, e o admin sempre foi derivado. Ficam como registro do
  // acordo vigente, e é assim que devem ser tratados: mudar aquele número no banco NÃO muda
  // mais o que se paga. Quem lê a tabela esperando a fonte da verdade vai errar — é a mesma
  // armadilha de `perfis.plano`, e por isso está escrito aqui em vez de descoberto depois.
  // O que DECIDE hoje: `total_pct`, `consultor_pct`, `analista_pct` e o override individual
  // em `perfis.honorario_exito_pct`, que continua vencendo o padrão calculado.
  const analistaPct = analistaId ? pctDe(analistaId, cfg.analista_pct) : 0;
  const parceiroPct = consultorId ? pctDe(consultorId, cfg.consultor_pct) : 0;
  const metadeDoRestante = Math.max(0, +((total - parceiroPct - analistaPct) / 2).toFixed(4));
  const advogadoOverride = perfis[advogadoId]?.honorario_exito_pct;
  const advogadoPct = advogadoId
    ? (advogadoOverride == null || advogadoOverride === '' ? metadeDoRestante : Math.max(0, Number(advogadoOverride) || 0))
    : 0;

  const envolvidos = [];
  if (advogadoId) envolvidos.push({ papel: 'advogado', id: advogadoId, nome: perfis[advogadoId]?.nome || null, pct: advogadoPct });
  if (analistaId) envolvidos.push({ papel: 'analista', id: analistaId, nome: perfis[analistaId]?.nome || null, pct: analistaPct });
  // `papel: 'consultor'` e a coluna `consultor_pct` ficam com o NOME ANTIGO de propósito: é o
  // slot do indicante no split, e renomear quebraria os snapshots já gravados em
  // `arrematacoes.honorarios_split`, que é o registro do que foi efetivamente pago.
  //
  // Quando o indicante É o advogado do caso, saem DUAS linhas para a mesma pessoa (4,5 + 1,0).
  // Somar numa linha só esconderia de onde vem cada parte: o comprovante e a conferência
  // precisam mostrar que uma fatia é pelo trabalho jurídico e a outra pela indicação.
  if (consultorId) envolvidos.push({ papel: 'consultor', id: consultorId, nome: perfis[consultorId]?.nome || null, pct: parceiroPct });

  const somaEnvolvidos = envolvidos.reduce((s, e) => s + e.pct, 0);
  const adminPct = Math.max(0, +(total - somaEnvolvidos).toFixed(4)); // admin equilibra o restante

  // Linha de 0% não entra no rateio (28/08). Com `analista_pct = 0` e o ADVOGADO passando a
  // atender a reunião — virando também o `analista_id` do caso —, o comprovante sairia com uma
  // linha "analista … 0% … R$ 0,00" para a mesma pessoa que já aparece como advogado. Num
  // documento financeiro isso não informa nada e sugere um pagamento que não existe. Quem
  // participou do caso está registrado em `casos`, que é onde essa informação pertence.
  const linhas = [
    { papel: 'admin', id: adminRow?.id || null, nome: adminRow?.nome || 'Admin (backup)', pct: adminPct, valor: +(valor * adminPct / 100).toFixed(2) },
    ...envolvidos.filter(e => e.pct > 0).map(e => ({ ...e, valor: +(valor * e.pct / 100).toFixed(2) })),
  ];
  return { total, valor, adminPct, linhas };
}
