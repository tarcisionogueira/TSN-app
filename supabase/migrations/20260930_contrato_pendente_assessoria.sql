-- 30/09 (dono): termo de contratação da assessoria e procuração são DOIS documentos. O termo
-- registrado pela equipe usa produto_tipo 'assessoria' (produto_id = caso, ou "<user>:<ref>" quando
-- a contratação ainda não tem imóvel); a procuração segue como 'arrematacao' (produto_id = caso).
alter table public.contratos_pendentes drop constraint if exists contratos_pendentes_produto_tipo_check;
alter table public.contratos_pendentes add constraint contratos_pendentes_produto_tipo_check
  check (produto_tipo = any (array['plano','curso','ebook','arrematacao','assessoria']));
