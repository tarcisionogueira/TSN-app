-- FURO ABERTO POR MIM HOJE, pego pelo auditor no mesmo dia.
--
-- A migração `erros_cliente_stack_e_reabertura.sql` fez `create or replace` acrescentando
-- `p_stack` — o que no Postgres NÃO substitui a função: cria uma SOBRECARGA NOVA. E função
-- nova nasce com EXECUTE para PUBLIC. Resultado: a versão de 6 parâmetros seguia trancada
-- (anon=false, como sempre foi), mas a de 7 ficou aberta a anon e authenticated.
--
-- Por que isso importa: é SECURITY DEFINER e escreve em `erros_cliente` por fora da RLS.
-- Qualquer visitante podia injetar erro falso — envenenando o check-up de saúde e o Cliente
-- 360, que são justamente as telas onde a gente vai OLHAR quando algo quebrar de verdade.
-- A RPC nunca precisou de anon: quem chama é `api/log-erro-cliente.js`, com service key.
--
-- LIÇÃO PARA A PRÓXIMA VEZ: acrescentar parâmetro a uma RPC SECURITY DEFINER é criar função
-- nova. Todo `create or replace` que muda a ASSINATURA precisa vir com os `revoke` junto.
--
-- Também some a sobrecarga velha de 6 parâmetros: ninguém a chama, e duas assinaturas quase
-- iguais é ambiguidade esperando para virar bug.
revoke all on function public.registrar_erro_cliente(text,text,text,text,text,uuid,text) from public;
revoke all on function public.registrar_erro_cliente(text,text,text,text,text,uuid,text) from anon, authenticated;
grant execute on function public.registrar_erro_cliente(text,text,text,text,text,uuid,text) to service_role;

drop function if exists public.registrar_erro_cliente(text,text,text,text,text,uuid);
