/**
 * CADÊNCIA DO E-MAIL DE OPORTUNIDADES POR SEGMENTO (pedido do dono, 24/09).
 *
 * O dono pediu custo × efetividade priorizando quem paga. Medido nos 60 dias anteriores: o
 * gratuito NOVO clica 10%, o ATIVO no site 8,5%, o INATIVO 0,5% (1 clique em 204 e-mails).
 * Mandar semanal a quem não abre gasta reputação do domínio — e quem paga a conta é o e-mail
 * do PAGANTE, que passa a cair no spam junto.
 *
 * Os números vêm de `app_config.cadencia_email` (JSON, editável sem deploy). `PADRAO` é só o
 * que vale se a leitura falhar — e o cron registra que caiu no padrão.
 */
export const PADRAO = {
  pagante: 7, assessorado: 14, novo: 7, ativo: 14, inativo: 28, pausado: 60,
  novo_dias_conta: 14, ativo_janela_dias: 30, pausa_apos_sem_abrir: 7,
  itens_padrao: 12, itens_gratuito_ativo: 6,
  imediato_max_semana: 2, imediato_piso_pontos: 80, imediato_janela_horas: 36,
};

export const ROLES_PAGANTE = new Set(['top2', 'top2_anual', 'clube', 'admin']);

const DIA = 24 * 3600 * 1000;

/**
 * @param {{role, created_at}} perfil
 * @param {{ultima_atividade, ultimo_clique, enviados_ult7, abertos_ult7}|undefined} sinais
 * @param {object} cfg  PADRAO mesclado com app_config.cadencia_email
 * @param {number} agora  Date.now()
 * @returns {{segmento, dias, itens, rotuloFrequencia}}
 */
export function segmentoCadencia(perfil, sinais, cfg = PADRAO, agora = Date.now()) {
  const c = { ...PADRAO, ...(cfg || {}) };
  const t = (d) => (d ? new Date(d).getTime() : 0);
  const itens = c.itens_padrao;
  if (ROLES_PAGANTE.has(perfil.role)) return { segmento: 'pagante', dias: c.pagante, itens, rotuloFrequencia: 'toda semana' };
  if (perfil.role === 'assessorado') return { segmento: 'assessorado', dias: c.assessorado, itens, rotuloFrequencia: 'a cada 15 dias' };
  if (agora - t(perfil.created_at) < c.novo_dias_conta * DIA) return { segmento: 'novo', dias: c.novo, itens, rotuloFrequencia: 'toda semana' };
  const janela = agora - c.ativo_janela_dias * DIA;
  if (t(sinais?.ultima_atividade) > janela || t(sinais?.ultimo_clique) > janela) {
    return { segmento: 'ativo', dias: c.ativo, itens: c.itens_gratuito_ativo, rotuloFrequencia: 'a cada 15 dias' };
  }
  // Pausa: N envios seguidos sem NENHUMA abertura (padrão 7 = 4 semanais + 3 mensais). Exige a
  // amostra cheia — quem ainda não recebeu N nunca é pausado por falta de chance de abrir.
  const pausar = (sinais?.enviados_ult7 || 0) >= c.pausa_apos_sem_abrir && (sinais?.abertos_ult7 || 0) === 0;
  if (pausar) return { segmento: 'pausado', dias: c.pausado, itens, rotuloFrequencia: 'de vez em quando' };
  return { segmento: 'inativo', dias: c.inativo, itens, rotuloFrequencia: 'uma vez por mês' };
}

/** O último envio foi recente demais para o segmento? (folga de 12 h: o cron roda 1x/dia). */
export function cedoDemais(ultimoEnvio, dias, agora = Date.now()) {
  if (!ultimoEnvio) return false;
  return new Date(ultimoEnvio).getTime() > agora - (dias * 24 - 12) * 3600 * 1000;
}
