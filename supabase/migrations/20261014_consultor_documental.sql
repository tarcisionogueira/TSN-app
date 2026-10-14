-- Consultor passa a gerar DOCUMENTAL (14/10, dono: "libere o documental para o consultor também").
-- Até aqui limite_ia('consultor','documental') = 0 → consumir_documental_por devolvia 'sem_documental'
-- e a tela trancava o card (ROLES_SEM_DOCUMENTAL em Analise.jsx). Cota igual à do mercadológico
-- dele (5/mês) — o consultor monta proposta da carteira e precisa dos dois relatórios do lote.
create or replace function public.limite_ia(p_role text, p_tipo text)
 returns integer
 language sql
 immutable
as $function$
  select case
    when p_role = 'admin' then null::int
    when p_tipo = 'indice' then case p_role
      when 'top2' then 3 when 'top2_anual' then 3
      when 'assessorado' then 3 when 'assessorado_anual' then 3
      when 'clube' then 3 when 'clube_anual' then 3
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'documental' then case p_role
      when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'veiculo' then case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
    else case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
  end
$function$;
