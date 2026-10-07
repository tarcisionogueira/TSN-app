-- 07/10 (print do dono, LJUD 217021 — casa Alphaville 12): a ficha mostrava o resumo
-- "título — leiloeiro" e o site do leiloeiro, o texto inteiro da matrícula.
--
-- O enriquecimento sob demanda (api/enriquecer-lote.js) JÁ buscava e gravava o texto completo
-- quando o cliente abria a ficha — mas a coleta diária fazia upsert por cima com o resumo de
-- novo. Medido em 07/10: só 54 de 1.076 LJUD ativos com texto; ZUK 811/869, MEGA 336/433,
-- VIP 108/109, BIASI 72/72 no mesmo estado. O trabalho do enriquecimento durava até o próximo cron.
--
-- Mesma regra dos outros "preservar_*": dado bom não é trocado por pior. Só barra o caso medido:
-- descrição nova que é RESUMO (menos de 40 caracteres além do título — o mesmo critério de
-- `descEcoDoTitulo` em enriquecer-lote.js e ImovelDetalhe.jsx) por cima de texto real. Texto
-- real novo, maior OU menor (leiloeiro corrigiu), continua entrando normalmente.
create or replace function public.preservar_descricao_completa()
returns trigger
language plpgsql
as $function$
declare
  util_old int := length(regexp_replace(replace(coalesce(old.descricao, ''), coalesce(old.titulo, ''), ''), '[\s—·|-]+', '', 'g'));
  util_new int := length(regexp_replace(replace(coalesce(new.descricao, ''), coalesce(new.titulo, ''), ''), '[\s—·|-]+', '', 'g'));
begin
  if new.descricao is distinct from old.descricao
     and util_old >= 40
     and util_new < 40 then
    new.descricao := old.descricao;
  end if;
  return new;
end;
$function$;

create or replace trigger trg_preservar_descricao_completa
  before update on public.imoveis_leilao
  for each row
  execute function public.preservar_descricao_completa();
