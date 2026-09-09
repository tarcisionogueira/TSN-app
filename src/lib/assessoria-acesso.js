// QUEM PODE CONTRATAR A ASSESSORIA — a parte da regra que depende só do PAPEL.
//
// Regra do dono (09/09): "a assessoria só deve poder ser contratada por quem é Investidor Pro.
// Para quem é explorador pode aparecer na tela de planos, mas com informações limitadas de
// valores, informando que deve ser Investidor Pro para contratar."
//
// Ela JÁ era aplicada no servidor (api/_assessoria.js) e no Checkout — só que escrita duas
// vezes, e a tela de Planos não sabia dela: o explorador via o preço cheio e um botão
// "Contratar assessoria →" que levava a um checkout que então dizia "vire Pro primeiro".
// Regra repetida é regra que diverge (foi o que custou o toast de "relatório pronto" hoje de
// manhã), então ela mora aqui e os três leem daqui.
//
// O que NÃO está aqui, de propósito: contrato de assessoria vivo, arremate sinalizado e caso em
// andamento. Isso exige ler o banco e continua em api/_assessoria.js — este arquivo responde
// apenas "o papel dele permite?", que é o que uma tela consegue decidir sozinha.
export const ROLES_EQUIPE_ASSESSORIA = ['admin', 'analista', 'advogado', 'suporte'];

export function acessoAssessoria(role) {
  const r = String(role || '');
  if (/^clube/.test(r)) return 'incluido';                 // Leilão Club já tem, não contrata avulsa
  if (ROLES_EQUIPE_ASSESSORIA.includes(r)) return 'pode';
  if (/^(top2|assessorado)/.test(r)) return 'pode';        // Investidor Pro e quem já é assessorado
  return 'requer_pro';                                     // explorador e visitante deslogado
}

export const podePeloPapel = (role) => acessoAssessoria(role) === 'pode';
