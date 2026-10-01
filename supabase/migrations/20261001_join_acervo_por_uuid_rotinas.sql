-- MESMO DEFEITO DO /analises (20261001_minhas_analises_lista_join_por_uuid), nas três rotinas de
-- banco que ainda casavam o acervo por `i.id::text = <texto>`. O cast no lado de imoveis_leilao
-- (uuid, 83 mil linhas / 291 MB) impede a PK e força SEQ SCAN a cada chamada — e
-- `atualizar_confiabilidade_leiloeiro` roda a CADA relatório documental gerado, ou seja, dentro
-- do tempo que o cliente espera. Troca por `i.id = (texto::uuid quando tem formato de uuid)`:
-- texto que não é uuid já não casava antes (semântica preservada) e a PK volta a ser usada.
-- Reescreve só a linha do join, a partir da definição VIGENTE de cada função.
do $$
declare
  r record;
  def text;
  novo text;
  uu constant text := '''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('atualizar_confiabilidade_leiloeiro', 'limpar_analises_orfas', 'proximas_fotos_espelho')
  loop
    def := pg_get_functiondef(r.oid);
    novo := def;
    novo := replace(novo, 'i.id::text = d.imovel_id',
      'i.id = (case when d.imovel_id::text ~* ' || uu || ' then d.imovel_id::text::uuid end)');
    novo := replace(novo, 'i.id::text = ja.imovel_id',
      'i.id = (case when ja.imovel_id::text ~* ' || uu || ' then ja.imovel_id::text::uuid end)');
    novo := replace(novo, 'i.id::text = g.imovel_id::text',
      'i.id = (case when g.imovel_id::text ~* ' || uu || ' then g.imovel_id::text::uuid end)');
    novo := replace(novo, 'i.id::text = a.id',
      'i.id = (case when a.id::text ~* ' || uu || ' then a.id::text::uuid end)');
    if novo = def then
      raise exception 'join por id::text não encontrado em % — a definição mudou, revisar', r.proname;
    end if;
    execute novo;
  end loop;
end $$;
