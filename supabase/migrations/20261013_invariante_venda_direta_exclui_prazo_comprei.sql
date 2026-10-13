-- 13/10: `venda_direta_com_praca` acusava 531 — TODOS do COMPREI (PGFN), desde 10/10. Ali
-- `data_leilao` é o `prazoParaEncerramento` da venda direta ONLINE (prazo de proposta), não praça;
-- leilao_ja_encerrado() já ignora data em venda direta. Forma nº 10: o invariante media "tem data"
-- e reportava "classificação errada". Exclui a fonte cuja data é, por desenho, prazo de proposta;
-- continua vigiando qualquer outro scraper/webhook que reintroduza o defeito de 09/09.
do $$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  velho text := $v$(select count(*) from imoveis_leilao where ativo and modalidade ilike '%venda%direta%' and data_leilao is not null)$v$;
  novo  text := $v$(select count(*) from imoveis_leilao where ativo and modalidade ilike '%venda%direta%' and data_leilao is not null and fonte <> 'COMPREI')$v$;
begin
  if position(novo in d) > 0 then return; end if;
  if position(velho in d) = 0 then raise exception 'trecho do venda_direta_com_praca não encontrado'; end if;
  execute replace(d, velho, novo);
end $$;
