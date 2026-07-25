-- CONSULTOR APOSENTADO (o MLM/Programa de Parceiros o substitui). Migração idempotente:
-- quem tiver role='consultor' vira PARCEIRO COMUM (role 'explorador'), PRESERVANDO link e rede
-- (indicado_por, codigo_indicacao) e o saldo/comissões. Mantém o aceite de parceiro (grandfather:
-- se não tinha, marca agora) para seguir com acesso à Minha Rede/Comissões. Também rebaixa
-- vendedor_tipo 'consultor'->'afiliado' e desativa convites de consultor pendentes.
-- Na data desta migração afeta 0 linhas (não há consultores), mas garante a regra para legado.
update public.perfis
   set role = 'explorador',
       parceiro_aceite_em = coalesce(parceiro_aceite_em, now())
 where role = 'consultor';

update public.perfis set vendedor_tipo = 'afiliado' where vendedor_tipo = 'consultor';

update public.convites_vendedor set ativo = false where tipo = 'consultor' and ativo = true;
