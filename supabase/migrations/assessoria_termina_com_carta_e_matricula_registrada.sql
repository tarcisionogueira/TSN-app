-- 29/08 — A ASSESSORIA TERMINA COM DOCUMENTO, NÃO COM CALENDÁRIO (decisão do dono)
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- *"A assessoria termina com a carta da arrematação e matrícula do registro."*
--
-- Até aqui o fim era `plano_assinaturas.acesso_fim`, vindo de `planos_config.acesso_meses` (12)
-- — um PRAZO. Prazo é teto administrativo, não conclusão de serviço: uma assessoria que entrega
-- a carta e a matrícula em 4 meses está entregue e continuaria "ativa" por mais 8; e uma que
-- passa dos 12 sem os documentos NÃO está concluída, está vencida. São coisas diferentes e
-- agora têm estados diferentes. `acesso_fim` continua existindo e valendo como teto.
--
-- ⚠️ TRÊS EXIGÊNCIAS, cada uma fechando um jeito de concluir sem prova:
--  1. **Arquivo legível** (`storage_path is not null`) nos dois documentos. Registro de link não
--     encerra serviço — foi a distinção que custou o dia de hoje na cobertura documental.
--  2. **`imovel_id` vinculado.** Sem imóvel não há onde procurar, e a função deixa a assinatura
--     ATIVA em vez de concluir por engano: silêncio aqui é a resposta correta, não uma falha.
--  3. **`matricula_registrada` é tipo NOVO**, distinto de `matricula`. A do LEILÃO é publicada
--     pelo leiloeiro ANTES da arrematação e já está no acervo desde a captura; a do REGISTRO sai
--     depois de transferido o imóvel. Confundir as duas encerraria a assessoria **no dia em que
--     ela começa** — e o acervo tem 4.974 imóveis com `matricula`, então não seria sutil.
create or replace function public.concluir_assessorias_entregues(p_limite int default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; v_ids uuid[];
begin
  -- APLICA regra_negocio['assessoria.encerramento'] — a chave é citada aqui de propósito:
  -- `auditoria_regras_negocio()` procura a menção no corpo da função declarada em
  -- `aplicada_por`, e sem ela a regra sai como ÓRFÃ (foi o que ela acusou na 1ª versão desta
  -- migração, pela terceira vez hoje — o auditor está fazendo o trabalho dele).
  with prontas as (
    select a.id
      from plano_assinaturas a
     where a.status = 'ativo'
       and a.plano_key = 'assessorado'
       and a.imovel_id is not null
       and exists (select 1 from imovel_anexos x
                    where x.imovel_id = a.imovel_id and x.tipo = 'carta_arrematacao'
                      and x.storage_path is not null)
       and exists (select 1 from imovel_anexos x
                    where x.imovel_id = a.imovel_id and x.tipo = 'matricula_registrada'
                      and x.storage_path is not null)
     limit p_limite
  ), u as (
    update plano_assinaturas a
       set status = 'concluido',
           -- `acesso_fim` recua para AGORA: o serviço acabou, e deixar a data antiga faria a
           -- tela prometer acesso que a conclusão já encerrou.
           acesso_fim = now(),
           notas_admin = concat_ws(' | ', a.notas_admin,
             'concluida automaticamente: carta de arrematacao + matricula registrada no imovel ' || a.imovel_id)
      from prontas p where a.id = p.id
    returning a.id, a.user_id
  )
  select count(*), array_agg(id) into v_n, v_ids from u;

  return jsonb_build_object('concluidas', coalesce(v_n, 0), 'ids', coalesce(v_ids, '{}'));
end $$;

revoke all on function public.concluir_assessorias_entregues(int) from public, anon, authenticated;
grant execute on function public.concluir_assessorias_entregues(int) to service_role;

insert into regra_negocio (chave, valor, descricao, aplicada_por, ativo) values (
  'assessoria.encerramento',
  jsonb_build_object(
    'criterio', 'documental',
    'documentos', array['carta_arrematacao','matricula_registrada'],
    'exige_arquivo_legivel', true,
    'exige_imovel_vinculado', true,
    'prazo_e_teto_nao_conclusao', true),
  'A assessoria TERMINA com a carta de arrematacao e a matricula do REGISTRO no imovel '
  'vinculado (decisao do dono, 29/08) — nao pelo prazo de acesso_meses, que segue existindo como '
  'TETO administrativo. Os dois documentos precisam ter arquivo legivel (storage_path): registro '
  'de link nao encerra servico. Sem imovel_id vinculado a assinatura fica ATIVA, porque nao ha '
  'onde procurar a prova. `matricula_registrada` e tipo distinto de `matricula` (a do leilao, '
  'publicada pelo leiloeiro antes da arrematacao): confundir as duas encerraria a assessoria no '
  'dia em que ela comeca.',
  array['concluir_assessorias_entregues'],
  true)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;
