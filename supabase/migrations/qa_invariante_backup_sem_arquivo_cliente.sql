-- INVARIANTE NOVO: a última cópia off-region não varreu o manifesto inteiro.
--
-- POR QUE (15/08). O backup off-region é a única defesa contra perda definitiva de arquivo de
-- cliente, e passou 4 dias copiando 100% documento de leiloeiro e 0% upload de cliente. O
-- rastro estava lá — `ok=false`, `arquivos_iguais=0` — mas essa combinação é AMBÍGUA: em
-- 14/08 foi lida (corretamente, segundo o próprio CLAUDE.md) como "o job está atrás do
-- crescimento diário". Progresso e trabalho inútil produzem o mesmo `arquivos_novos: 658`;
-- só a COMPOSIÇÃO os separa, e composição não estava em lugar nenhum do painel.
--
-- A MEDIDA CERTA é cobertura da própria execução: `arquivos_total` é o tamanho do manifesto
-- que ela viu, e `novos + iguais` é o que ela realmente processou. A diferença é o que ficou
-- de fora — e não depende de interpretar `iguais`, nem de comparar com o manifesto de hoje.
--
-- ⚠️ A primeira versão desta migração comparava o manifesto ATUAL (49, já corrigido) com o
-- processado da última execução (658, ainda do manifesto velho) e dava 0 por subtração
-- negativa: verde por acidente aritmético, no invariante escrito para pegar justamente um
-- verde acidental. Fica registrado porque a lição é a do dia: número que só pode cair para
-- o lado bom não está medindo nada.
--
-- Verde é 0. Valor N = N arquivos que a última execução não alcançou.
do $$
declare def text; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc
   where proname = 'qa_invariantes' and pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'qa_invariantes() não encontrada'; end if;

  novo := $q$     ('backup_sem_arquivo_cliente','Backup off-region não varreu o manifesto inteiro','Infra','bug',
       (select greatest(0, coalesce(b.arquivos_total,0) - coalesce(b.arquivos_novos,0) - coalesce(b.arquivos_iguais,0))
          from backup_execucoes b where not b.dormante order by b.executado_em desc limit 1), 0),
$q$;

  -- Substitui a versão anterior, se houver; senão insere antes de `aval_ausente_com_doc`.
  if position('backup_sem_arquivo_cliente' in def) > 0 then
    -- SEM a flag 'n': o bloco a substituir ocupa várias linhas, e 'n' é exatamente o que
    -- impede o `.` de atravessar a quebra de linha — com ela o replace não casa nada, o
    -- `def` volta inalterado e o `execute` recria a função idêntica, em silêncio.
    def := regexp_replace(def, E'\\s*\\(''backup_sem_arquivo_cliente''.*?\\), 0\\),\\n', E'\n' || novo);
  else
    def := replace(def, '     (''aval_ausente_com_doc''', novo || '     (''aval_ausente_com_doc''');
  end if;
  execute def;
end $$;
