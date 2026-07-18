-- url NOT NULL fazia o limpar-documentos-cron FALHAR ao "limpar" o anexo (ele faz
-- url=null): o arquivo era apagado do Storage mas o anexo mantinha storage_path/url
-- apontando para o objeto inexistente → botão "Matrícula/Edital" dava 404. Um anexo
-- sem arquivo (limpo pela retenção) legitimamente não tem url. Torna a coluna nullable.
alter table public.imovel_anexos alter column url drop not null;
