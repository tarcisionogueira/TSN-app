-- AVISO "OS DOCUMENTOS CHEGARAM" COM A MESMA RÉGUA DO CHAMADO (05/11)
--
-- Achado no primeiro caso real (lote de Tramandaí): o pedido ao leiloeiro pediu SÓ a matrícula —
-- o edital já tinha sido lido do texto da página do lote, e o documental não precisa de outro.
-- A leiloeira respondeu, a equipe anexou a matrícula, e o gatilho do chamado (20261104b) fechou
-- certo: "os documentos que faltavam já estão no lote". Mas `documentos_lote_completos` exigia
-- também o ARQUIVO do edital (selo ou anexo), que esse lote nunca teve — então o cliente que
-- esperava nunca seria avisado, com a análise já liberada para gerar.
--
-- Régua nova: matrícula E (edital/regras OU nenhum pedido do lote pediu edital/regras). É a mesma
-- leitura do gatilho que fecha o chamado (`pede_ed`/`pede_rv` a partir de `itens_pedidos`). Sem pedido
-- nenhum ligado ao lote, continua exigindo os dois, como antes.

create or replace function public.documentos_lote_completos(p_imovel uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with ped as (
    select count(*) as n,
           coalesce(bool_or(lower(x) ~ '(edital|regras)'), false) as pede_edital
      from documental_pedidos_leiloeiro p
      left join lateral jsonb_array_elements_text(coalesce(p.itens_pedidos, '[]'::jsonb)) x on true
     where p.imovel_id = p_imovel::text  -- documental_pedidos_leiloeiro.imovel_id é TEXTO
  )
  select (coalesce(i.tem_matricula_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo = 'matricula'))
     and (coalesce(i.tem_edital_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo in ('edital', 'regras_venda', 'regras'))
            or (ped.n > 0 and not ped.pede_edital))
    from imoveis_leilao i, ped where i.id = p_imovel
$$;
revoke all on function public.documentos_lote_completos(uuid) from public, anon, authenticated;

-- Quem já estava esperando num lote que fica completo pela régua nova (a matrícula chegou ANTES
-- desta migração e o gatilho do anexo já tinha passado): marca agora. O cron avisa em até 20 min.
select public.documentos_aguardando_marcar_pronto(s.imovel_id)
  from (select distinct imovel_id from public.documentos_aguardando where pronto_em is null) s;
