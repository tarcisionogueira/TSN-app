-- Pedido do dono (12/09): o "Pedir ao leiloeiro" (api/pedir-documento-leiloeiro.js) ganha um
-- passo de revisão — quem usa pode complementar o texto antes de mandar — e passa a exigir
-- registro do texto REALMENTE enviado (pode divergir do rascunho gerado pela IA). A auditoria
-- guardava só os itens pedidos (`itens_pedidos`), não o corpo final da carta.
alter table public.documental_pedidos_leiloeiro
  add column if not exists texto_enviado text;
