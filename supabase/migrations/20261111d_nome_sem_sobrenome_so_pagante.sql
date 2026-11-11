-- Invariante `nome_sem_sobrenome` passa a contar só quem PAGA (11/11, decisão do dono):
-- "pelo cadastro explorador a ideia é aceitar um nome ou nome completo. Já em pagamentos exigir nome completo."
-- O cadastro grátis aceita só o primeiro nome (validarNomeCadastro / erroNomeCadastro); o checkout exige
-- nome e sobrenome antes de pagar. Explorador com um nome só deixou de ser defeito; pagante com um nome
-- só é falha do checkout e continua acusando (limite 0).
--
-- A função `qa_invariantes()` tem ~38 mil caracteres; a troca é feita sobre a definição VIVA (só o trecho
-- deste invariante), para não regravar à mão o resto do corpo e arriscar divergir do que está em produção.
do $mig$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  velho text := $v$('nome_sem_sobrenome','Cliente cadastrado com um nome so (antes da regra de 18/08)','Conta','gap',
       (select count(*) from perfis
         where array_length(regexp_split_to_array(btrim(coalesce(nome,'')), '\s+'), 1) < 2), 2),$v$;
  novo text := $n$('nome_sem_sobrenome','Cliente PAGANTE com um nome so (pagamento exige nome completo; Explorador pode, 11/11)','Conta','gap',
       (select count(*) from perfis
         where array_length(regexp_split_to_array(btrim(coalesce(nome,'')), '\s+'), 1) < 2
           and coalesce(role,'') not in ('', 'explorador', 'admin', 'analista', 'advogado', 'consultor')), 0),$n$;
begin
  if position(velho in d) = 0 then
    raise exception 'trecho de nome_sem_sobrenome não encontrado em qa_invariantes() — conferir a definição viva';
  end if;
  execute replace(d, velho, novo);
end
$mig$;
