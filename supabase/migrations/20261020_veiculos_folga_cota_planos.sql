-- 20/10 — plano Veículos / Combo: folga de cobrança, cota exibida e cadastro dos planos.
-- • FOLGA DE 3 DIAS: o acesso vale até `acesso_veiculos_ate` + 3 dias. A renovação mensal do MP/Asaas
--   costuma cair no próprio dia do vencimento, às vezes depois de retentativas; sem folga o cliente em dia
--   perdia o leiloeiro por algumas horas todo mês. A folga mora AQUI (leitura) e não na gravação
--   (estenderAcessoVeiculos soma exatamente 1 mês), senão o acesso escorregaria 3 dias a cada renovação.
-- • minhas_cotas: Explorador COM plano Veículos conta por mês (não como amostra) e a resposta traz
--   `veiculo.acesso` / `veiculo.acesso_ate` para a tela decidir o cadeado sem outra consulta.
-- • planos_config: 'veiculos' (29,90) e 'combo' (99,90), recorrentes, públicos. Ver "DUAS TRILHAS" em
--   api/_webhook-core.js. registrar_preco_contratado segue só para top2/clube (no-op nas chaves novas,
--   de propósito: não há reajuste agendado para elas).

create or replace function public.tem_acesso_veiculos(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = p_user_id
                   and (p.role in ('admin','analista','consultor','advogado')
                        or p.acesso_veiculos_ate > now() - interval '3 days'))
$$;

create or replace function public.limite_ia_efetivo(p_user_id uuid, p_tipo text)
 returns integer language sql stable security definer set search_path to 'public' as $function$
  select case
    when p.role = 'admin' then null::int
    when p_tipo = 'veiculo' and p.role in ('analista','advogado','consultor') then public.limite_ia(p.role, p_tipo)
    when p_tipo = 'veiculo' then case when p.acesso_veiculos_ate > now() - interval '3 days' then 10 else 0 end
    when p.plano_legado
         and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then case p_tipo when 'indice' then 5 else 15 end
    else public.limite_ia(p.role, p_tipo)
  end
  from public.perfis p where p.id = p_user_id
$function$;

do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.consumir_veiculo_por'::regproc) into d;
  novo := replace(d, 'SELECT acesso_veiculos_ate > now() FROM perfis', $q$SELECT acesso_veiculos_ate > now() - interval '3 days' FROM perfis$q$);
  if novo = d then raise exception 'consumir_veiculo_por: trecho do acesso não encontrado'; end if;
  execute novo;

  select pg_get_functiondef('public.minhas_cotas'::regproc) into d;
  novo := replace(d, 'v_uv := greatest(v_p.avu, analises_veiculo_usadas_mes(p_user_id, null));',
    $q$v_uv := case when public.tem_acesso_veiculos(p_user_id)
      then greatest(case when v_p.vm = v_mes then v_p.vc else 0 end, analises_veiculo_usadas_mes(p_user_id, date_trunc('month', now())))
      else greatest(v_p.avu, analises_veiculo_usadas_mes(p_user_id, null)) end;$q$);
  novo := replace(novo, $q$'veiculo',    jsonb_build_object('usado',v_uv,'limite',v_lv,'bonus',v_p.bv,'ilimitado',(v_lv is null),'amostra',v_amostra),$q$,
    $q$'veiculo',    jsonb_build_object('usado',v_uv,'limite',v_lv,'bonus',v_p.bv,'ilimitado',(v_lv is null),
                     'amostra', v_amostra and not public.tem_acesso_veiculos(p_user_id),
                     'acesso', public.tem_acesso_veiculos(p_user_id),
                     'acesso_ate', (select acesso_veiculos_ate from perfis where id = p_user_id)),$q$);
  if novo = d or position('acesso_ate' in novo) = 0 then raise exception 'minhas_cotas: trechos não encontrados'; end if;
  execute novo;
end $$;

insert into public.planos_config (plano_key, nome, preco, cobrar, ativo, assinatura, comissao_pct, pagamento_tipo, publico, tratamento)
values ('veiculos', 'Leilão de Veículos', 29.90, true, true, true, 25, 'recorrente', 'cliente', 'assinante do Leilão de Veículos'),
       ('combo', 'Combo Imóveis + Veículos', 99.90, true, true, true, 25, 'recorrente', 'cliente', 'assinante do Combo Imóveis + Veículos')
on conflict (plano_key) do nothing;

-- Revisão 20/10: tem_acesso_veiculos(p_user_id) só responde sobre a PRÓPRIA conta (ou para o servidor/equipe).
create or replace function public.tem_acesso_veiculos(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p
                  where p.id = p_user_id
                    and (p_user_id = auth.uid() or (select auth.role()) = 'service_role' or public.eh_equipe())
                    and (p.role in ('admin','analista','consultor','advogado')
                         or p.acesso_veiculos_ate > now() - interval '3 days'))
$$;
