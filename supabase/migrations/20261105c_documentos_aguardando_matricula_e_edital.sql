-- AVISO "OS DOCUMENTOS CHEGARAM" EXIGE MATRÍCULA E EDITAL EM ARQUIVO (05/11, dono)
--
-- "Edital e matrícula são o básico para avaliar um leilão" e "o relatório não deve ser gerado sem o
-- edital e a matrícula". A 20261105b tinha afrouxado a régua (bastava o que o pedido pediu), porque o
-- pedido de Tramandaí saiu só com a matrícula. Agora todo pedido ao leiloeiro leva os dois
-- (api/_pedido-leiloeiro-auto.js), e a geração do documental não conta mais a página do lote como
-- edital (api/gerar-documental.js) — então avisar o cliente só com a matrícula seria mandá-lo gerar
-- um relatório que a trava vai recusar. Volta a régua original: matrícula E (edital ou regras),
-- pelo selo do lote ou por anexo.

create or replace function public.documentos_lote_completos(p_imovel uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select (coalesce(i.tem_matricula_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo = 'matricula'))
     and (coalesce(i.tem_edital_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo in ('edital', 'regras_venda', 'regras')))
    from imoveis_leilao i where i.id = p_imovel
$$;
revoke all on function public.documentos_lote_completos(uuid) from public, anon, authenticated;
