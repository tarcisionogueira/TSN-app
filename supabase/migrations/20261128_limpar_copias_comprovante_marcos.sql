-- 28/11: remove as 61 cópias do comprovante de 15/10 do Marcos (imóvel dfc5ab9b) gravadas em laço pelo
-- gerar-documental entre 26/11 13:47 e 27/11 09:45 (causa consertada em 7698e2e). Fica o original
-- 18714eab (parcela_status 'paga', 26/11 13:33). Autorizado pelo dono no chat em 28/11 (pendência #529).
delete from public.imovel_anexos
 where imovel_id = 'dfc5ab9b-6c5d-49ba-97ec-57d704bc70ab'
   and tipo = 'comprovante_parcela'
   and parcela_status = 'aviso'
   and criado_em > '2026-11-26 13:40'
   and criado_em < '2026-11-27 09:46'
   and storage_path like 'casos/dfc5ab9b-6c5d-49ba-97ec-57d704bc70ab/%\_comprovante\_parcela.pdf'
   and id <> '18714eab-c914-4b39-a7a8-70e21233b023';
