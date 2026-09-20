-- O botão "Enviar e-mail" (api/enviar-email-caso.js) agora também aceita veiculo_id (21/09,
-- pedido do dono: levar a mesma tela de análise pros veículos). Mesmo padrão de imovel_id:
-- coluna opcional, preenchida só quando o envio partiu de VeiculoDetalhe.jsx.
alter table public.caso_emails_enviados add column if not exists veiculo_id text;
