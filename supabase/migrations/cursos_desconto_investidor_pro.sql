-- Pedido do dono (13/09, noite): quando os cursos pagos lançarem, dar 10% de desconto para
-- quem já é Investidor Pro (role='top2'/'top2_anual'). Coluna nova, mesmo espírito de
-- `desconto_vista_pct` (já existe em cursos_admin/ebooks_admin) mas condicionada ao PLANO do
-- comprador, não à forma de pagamento. Escopo só em cursos_admin — ebooks já são de graça
-- para top2 (ebook_tem_acesso), então um desconto de plano ali não faz sentido.
alter table public.cursos_admin
  add column if not exists desconto_investidor_pro_pct numeric(5,2) not null default 0
  check (desconto_investidor_pro_pct >= 0 and desconto_investidor_pro_pct <= 100);
