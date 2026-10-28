-- 28/10 (dono): rascunho montado com anexos que já estão na caixa (e-mails recebidos) voltava sem eles.
-- O Encaminhar manda REFERÊNCIAS ({id da mensagem, anexo_id, anexo_idx, nome}) e o servidor resolve o arquivo
-- arquivado (api/email-caixa.js → resolverAnexo, com a mesma cerca de dono); o rascunho não guardava a lista.
alter table public.email_rascunhos add column if not exists encaminhar_anexos jsonb;
comment on column public.email_rascunhos.encaminhar_anexos is 'Anexos de mensagens da caixa a encaminhar (28/10): [{id, anexo_id, anexo_idx, nome}] — mesmo formato do Encaminhar';
