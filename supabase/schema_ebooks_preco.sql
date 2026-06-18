-- Adiciona coluna preco à tabela ebooks_admin (substitui o campo gratuito)
-- Execute no SQL Editor do Supabase

alter table public.ebooks_admin
  add column if not exists preco numeric default 0;

-- Migra dados: ebooks marcados como gratuito=true ficam com preco=0
update public.ebooks_admin set preco = 0 where gratuito = true;

-- Adiciona colunas para imóveis fracionados na tabela de leilão
alter table public.imoveis_leilao
  add column if not exists fracionado boolean default false,
  add column if not exists url_lote   text;

create index if not exists idx_imoveis_leilao_fracionado on public.imoveis_leilao(fracionado);
