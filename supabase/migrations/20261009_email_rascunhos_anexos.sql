-- 09/10 (dono): anexar arquivos e colar imagem no e-mail da caixa. O rascunho guarda os anexos
-- que a tela já subiu para documentos/email/saida/<user>/, senão "Salvar e fechar" os perderia.
alter table public.email_rascunhos add column if not exists anexos jsonb;
comment on column public.email_rascunhos.anexos is 'Anexos enviados pela tela (09/10): [{arquivo, nome, tamanho, inline}] — arquivo = caminho em documentos/email/saida/<user>/';
