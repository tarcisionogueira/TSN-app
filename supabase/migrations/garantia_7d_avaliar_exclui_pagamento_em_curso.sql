-- Bug bounty 03/09 (P0): garantia_7d_avaliar() decide a âncora dos 7 dias (CDC art. 49)
-- olhando se existe pagamento 'approved' em mp_pagamentos — mas o webhook (mp-webhook.js)
-- já espelha o pagamento ATUAL em mp_pagamentos ANTES de chamar ativarPlanoDireto/
-- processarConfirmado, que é quem avalia a âncora. Resultado: a função sempre via o
-- PRÓPRIO pagamento que disparou a ativação como "histórico" (motivo pagante_com_historico)
-- e NUNCA ancorava quem virasse pagante por um caminho sem âncora prévia (ex.: conta
-- promovida manualmente/cortesia fazendo o 1º pagamento real) — negando o direito de
-- arrependimento em silêncio, exatamente na janela em que ele valeria.
--
-- Fix: parâmetro novo (com default, então CREATE OR REPLACE não quebra quem chama só com
-- p_user_id) que exclui o pagamento EM CURSO do EXISTS.
create or replace function public.garantia_7d_avaliar(p_user_id uuid, p_excluir_mp_payment_id text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_role text; v_ancora timestamptz; v_pagou boolean;
  -- regra: garantia.ancora_7d
begin
  if p_user_id is null then
    return jsonb_build_object('ancorar', false, 'motivo', 'sem_usuario', 'regra', 'garantia.ancora_7d');
  end if;
  select p.role, p.plano_pago_em into v_role, v_ancora from public.perfis p where p.id = p_user_id;
  if not found then
    return jsonb_build_object('ancorar', false, 'motivo', 'perfil_nao_encontrado', 'regra', 'garantia.ancora_7d');
  end if;
  if v_ancora is not null then
    return jsonb_build_object('ancorar', false, 'motivo', 'ja_ancorado', 'regra', 'garantia.ancora_7d');
  end if;
  if v_role is null or v_role not in ('top2','assessorado','clube','top2_anual','assessorado_anual','clube_anual') then
    return jsonb_build_object('ancorar', true, 'motivo', 'estreia', 'regra', 'garantia.ancora_7d');
  end if;
  select exists (select 1 from public.mp_pagamentos m
                  where m.user_id = p_user_id and m.status = 'approved'
                    and (p_excluir_mp_payment_id is null or m.mp_payment_id is distinct from p_excluir_mp_payment_id)) into v_pagou;
  return jsonb_build_object('ancorar', not v_pagou,
    'motivo', case when v_pagou then 'pagante_com_historico' else 'promovido_sem_cobranca' end,
    'regra', 'garantia.ancora_7d');
end; $function$;
