-- Matrícula só para quem pode ver o leiloeiro (dono, 25/10: "sim, esconda a matrícula também").
-- Até aqui imoveis_leilao_mascarado passava numero_matricula cru (4.274 lotes ativos) e a
-- ficha_cef.matricula dos ~21,6 mil lotes da Caixa. Agora, para quem não paga: numero_matricula
-- null e ficha_cef sem a chave 'matricula' (o resto da ficha — área, comarca, FGTS — segue público;
-- FichaTecnicaCEF já filtra campo vazio). create or replace sobre a definição VIGENTE, com troca
-- verificada: se o texto não bater (view mudou), aborta em vez de gravar meia máscara.
do $$
declare
  d text := pg_get_viewdef('public.imoveis_leilao_mascarado'::regclass, true);
  n text;
begin
  n := replace(d, E'    i.numero_matricula,\n',
    E'        CASE\n            WHEN p.pode THEN i.numero_matricula\n            ELSE NULL::text\n        END AS numero_matricula,\n');
  if n = d then raise exception 'numero_matricula: trecho não encontrado na view'; end if;
  d := n;
  n := replace(d, E'    i.ficha_cef,\n',
    E'        CASE\n            WHEN p.pode OR jsonb_typeof(i.ficha_cef) IS DISTINCT FROM ''object''::text THEN i.ficha_cef\n            ELSE i.ficha_cef - ''matricula''::text\n        END AS ficha_cef,\n');
  if n = d then raise exception 'ficha_cef: trecho não encontrado na view'; end if;
  execute 'create or replace view public.imoveis_leilao_mascarado with (security_invoker = false) as ' || n;
end $$;
