-- 04/10: `qa_invariantes_lenta` ficava vermelho TODO dia (5,5–10,5 s desde 18/09) por um custo já
-- perfilado e aceito (cache frio: imoveis_leilao 295 MB > 256 MB de shared_buffers; ver HANDOFF 03/10).
-- Alarme sempre aceso não avisa nada. Limite 5 s → 12 s (acima do pior observado, 10,5 s): volta a
-- acender só se PIORAR. Falha de rodada e rodada sumida (9999) continuam iguais.
do $$
declare d text;
  a1 text := $a$else coalesce(e.ms_servidor, e.ms) end
                   from public.qa_invariantes_execucao e
                  order by e.executado_em desc limit 1), 9999), 5000),$a$;
  a2 text := $a$ou o PAINEL (nao a rede) passou de 5s$a$;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if strpos(d, a1) = 0 or strpos(d, a2) = 0 then return; end if; -- já aplicada
  d := replace(replace(d, a1, replace(a1, '9999), 5000),', '9999), 12000),')), a2, 'ou o PAINEL (nao a rede) passou de 12s (custo de cache frio conhecido: 5-10s)');
  execute d;
end $$;
