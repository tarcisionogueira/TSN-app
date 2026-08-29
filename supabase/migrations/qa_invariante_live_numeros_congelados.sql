-- 29/08: par do cache de `live_plataforma_numeros`. Trocar "consulta que estoura o timeout" por
-- "linha lida em 1 ms" só é ganho se alguém vigiar quem ESCREVE a linha: cron parado devolve
-- número velho com cara de número atual, e ninguém percebe. 3 h de folga sobre a varredura horária.
create or replace function public.qa_invariante_live_numeros_congelados()
returns bigint language sql stable set search_path to 'public' as $$
  select case
    when (select coalesce(max(atualizado_em), '-infinity'::timestamptz)
            from public.plataforma_numeros_cache) < now() - interval '3 hours'
    then 1 else 0 end::bigint;
$$;

-- E o registro em qa_invariantes(). Aplicado no banco por reescrita da definição (a função é
-- grande e a linha entra imediatamente após `data_edital_recuou_prazo`); repetido aqui porque
-- migração escrita e não aplicada — e função aplicada e não migrada — são as duas direções da
-- forma nº 7 do CLAUDE.md. O bloco abaixo é idempotente e reproduz o mesmo efeito num banco novo.
do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='qa_invariantes';
  alvo := E'and atualizado_em > now() - interval ''30 days''), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('live_numeros_congelados' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''live_numeros_congelados'',''Números da vitrine da live parados (cron horário não recalcula)'',''Infra'',''bug'',\n       public.qa_invariante_live_numeros_congelados(), 0)';
  execute replace(d, alvo, novo);
end $do$;
