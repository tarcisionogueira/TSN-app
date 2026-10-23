-- 23/10: auditoria_seguranca() acusava `landing_numeros` (rpc_definer_anon, "atenção") desde que a
-- página inicial nova entrou (a8dc048). É leitura pública POR DESENHO: devolve só os números do acervo
-- guardados em app_config['landing_numeros'] (lotes, cidades, leiloeiros) para o visitante sem conta,
-- nenhuma PII — o mesmo caso de live_plataforma_numeros, que já está na allowlist. Fechar o EXECUTE
-- quebraria o topo da landing; o certo é registrar a exceção.
-- Edita a allowlist no próprio corpo vigente (idempotente: só troca se ainda não estiver lá).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.auditoria_seguranca'::regproc);
  if position('''landing_numeros''' in d) = 0 then
    d := replace(d, '''produto_downsell''', '''produto_downsell'',''landing_numeros''');
    if position('''landing_numeros''' in d) = 0 then
      raise exception 'allowlist de auditoria_seguranca mudou de forma — ajuste esta migração';
    end if;
    execute d;
  end if;
end $$;
