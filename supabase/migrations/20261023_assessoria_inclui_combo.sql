-- 23/10 (decisão do dono): a Assessoria passa a incluir o COMBO — Investidor Pro + Leilão de Veículos —
-- e não só o Pro. Enquanto o papel é `assessorado`, o cliente tem o acesso e a cota de veículos do Combo,
-- sem mensalidade. Ao concluir a assessoria o papel volta (regra assessoria.inclui_pro) e o acesso a
-- veículos volta a depender só de perfis.acesso_veiculos_ate (assinatura própria de Veículos/Combo).
--
-- O acesso a veículos é decidido em DOIS lugares do banco, e os dois precisam saber disto:
--   • tem_acesso_veiculos(): leiloeiro, link, pátio, relatório (front, RPCs e api/gerar-analise-veiculo);
--   • limite_ia_efetivo(_, 'veiculo'): a cota mensal (10, a mesma do Combo).
-- consumir_veiculo_por() e minhas_cotas() leem esses dois e não precisam mudar.

CREATE OR REPLACE FUNCTION public.tem_acesso_veiculos(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.perfis p
                  where p.id = p_user_id
                    -- Só a PRÓPRIA conta, salvo servidor (service_role) ou equipe (revisão 20/10): sem isto, qualquer
                    -- logado consultava se outra conta assina Veículos.
                    and (p_user_id = auth.uid() or (select auth.role()) = 'service_role' or public.eh_equipe())
                    and (p.role in ('admin','analista','consultor','advogado')
                         -- Assessoria inclui o Combo (23/10, regra_negocio['assessoria.inclui_combo'])
                         or p.role in ('assessorado','assessorado_anual')
                         or p.acesso_veiculos_ate > now() - interval '3 days'))
$function$;

CREATE OR REPLACE FUNCTION public.limite_ia_efetivo(p_user_id uuid, p_tipo text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.role = 'admin' then null::int
    when p_tipo = 'veiculo' and p.role in ('analista','advogado','consultor') then public.limite_ia(p.role, p_tipo)
    -- Assessoria inclui o Combo (23/10, regra_negocio['assessoria.inclui_combo']): mesma cota de veículos do Combo.
    when p_tipo = 'veiculo' and p.role in ('assessorado','assessorado_anual') then 10
    when p_tipo = 'veiculo' then case when p.acesso_veiculos_ate > now() - interval '3 days' then 10 else 0 end
    when p.plano_legado
         and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then case p_tipo when 'indice' then 5 else 15 end
    else public.limite_ia(p.role, p_tipo)
  end
  from public.perfis p where p.id = p_user_id
$function$;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('assessoria.inclui_combo',
  '{"inclui": ["top2", "veiculos"], "cota_veiculo_mes": 10, "cancela_recorrencias_ao_contratar": ["top2", "combo", "veiculos"]}'::jsonb,
  'Decisão do dono (23/10): enquanto a assessoria está ativa (papel assessorado), o cliente tem tudo do COMBO — Investidor Pro + Leilão de Veículos (leiloeiro, lote, pátio e 10 relatórios de veículo/mês) — sem mensalidade. Amplia assessoria.inclui_pro. Ao contratar, as recorrências de Investidor Pro, Combo e Leilão de Veículos são canceladas (api/_recorrencia-unica.js cancelarRecorrenciaPro). Ao concluir, o acesso a veículos volta a depender da assinatura própria (perfis.acesso_veiculos_ate).',
  array['tem_acesso_veiculos', 'limite_ia_efetivo'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();
