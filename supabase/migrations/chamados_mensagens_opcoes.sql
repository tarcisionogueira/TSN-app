-- BOTÕES DE RESPOSTA RÁPIDA NO CHAT DE SUPORTE (23/11, dono: "se fez uma pergunta, seria mais fácil
-- aparecer um botão sim e um botão não do que esperar que o usuário escreva").
-- A IA marca a pergunta de sim/não com [[SIM_NAO]]; api/chat-suporte.js tira o marcador do texto e grava
-- as opções aqui. As telas do cliente (ChatSuporte, MeusChamados) mostram os botões sob a ÚLTIMA mensagem
-- quando ela é da IA; o clique envia a opção como mensagem do cliente. Nulo = sem botões.
alter table public.chamados_mensagens add column if not exists opcoes text[];
comment on column public.chamados_mensagens.opcoes is
  'Respostas rápidas oferecidas ao cliente (ex.: {Sim,Não}) quando a mensagem da IA termina em pergunta de sim/não.';
