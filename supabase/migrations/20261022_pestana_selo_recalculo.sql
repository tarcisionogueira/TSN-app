-- #285 (22/10): doc_arquivo passou a aceitar a API do Pestana (20261022_doc_arquivo_api_pestana.sql),
-- mas o selo só é recalculado pelo trigger quando o lote é regravado. 325 lotes ativos ficaram com o
-- selo da regra antiga. Recalcula só os defasados (mesmas funções do trigger zzzz_set_tem_edital_doc).
update public.imoveis_leilao i
   set tem_edital_doc = public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos),
       tem_matricula_doc = public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
 where i.ativo and i.fonte = 'PESTANA'
   and (i.tem_edital_doc is distinct from public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos)
     or i.tem_matricula_doc is distinct from public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id));
