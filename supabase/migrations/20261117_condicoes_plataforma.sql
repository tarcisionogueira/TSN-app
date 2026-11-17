-- SELO DE PARCELAMENTO DO SISTEMA DE LANCES (17/11, caso REGIONALLEIL 902 — Porto Alegre).
-- O lote judicial tinha "ACEITA LANCE PARCELADO" na página do leiloeiro (LeilãoPro), nenhum PDF de edital, e o
-- relatório abriu à vista ("condições não lidas"). O coletor passa a gravar o selo aqui; quem decide o que ele
-- prova é api/_condicoes-origem.js (prova forte só em lote judicial — o art. 895 dá os números).
-- Forma: { parcelamentoPermitido: true, selo: 'ACEITA LANCE PARCELADO', tipo: 'lance'|'proposta', fonte: 'leilaopro' }
-- null = página lida sem selo, ou fonte que não publica selo.
alter table public.imoveis_leilao add column if not exists condicoes_plataforma jsonb;

comment on column public.imoveis_leilao.condicoes_plataforma is
  'Selo de parcelamento publicado pelo sistema de lances do leiloeiro (ex.: LeilãoPro "ACEITA LANCE PARCELADO"). Lido pelo decisor de condições de pagamento (api/_condicoes-origem.js).';
