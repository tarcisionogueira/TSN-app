-- =====================================================================================
-- O SELO "📄 MATRÍCULA" — E O CUSTO QUE QUASE PASSOU DESPERCEBIDO (18/08)
--
-- Continuação de `selo_documento_so_com_arquivo.sql`. A primeira versão do conserto ia
-- decidir o selo de matrícula só com o que a busca já carregava (`caixaMatriculaUrl()` +
-- `ehMatriculaValida(link_matricula)`). Medido ANTES de aplicar: isso removeria as 337
-- mentiras, mas apagaria o selo de **1.168** lotes — ou seja, 831 deles TÊM matrícula
-- (nos anexos do leiloeiro ou no nosso Storage) e perderiam o selo à toa.
--
-- Trocar uma mentira por um sumiço não é conserto. Com o sinal vindo do banco, como no
-- edital, o resultado medido é melhor nos DOIS lados:
--
--     selo antigo .......... 27.936 lotes ativos
--     selo novo ............ 28.504
--     mentiras removidas ...... 337  (prometia matrícula, não havia arquivo nenhum)
--     selos recuperados ....... 905  (havia matrícula, e o selo não aparecia)
--
-- Os 905 são lotes com `link_matricula` NULO cuja matrícula existe como anexo capturado
-- ou como PDF estático derivado da CEF — invisíveis para qualquer regra baseada no link.
-- =====================================================================================

alter table public.imoveis_leilao
  add column if not exists tem_matricula_doc boolean not null default false;

comment on column public.imoveis_leilao.tem_matricula_doc is
  'Existe matricula-ARQUIVO para este lote: PDF estatico da CEF (derivado de fonte/estado/fonte_id), link_matricula que seja arquivo, anexo do leiloeiro ou imovel_anexos. Mantida por gatilho — autoriza o selo "Matricula" na busca.';

create or replace function public.calc_tem_matricula_doc(
  p_id uuid, p_link text, p_anexos jsonb, p_fonte text, p_estado text, p_fonte_id text)
returns boolean language sql stable as $$
  select
     -- PDF estatico da Caixa: espelha caixaMatriculaUrl() em src/utils/caixa.js
     (p_fonte ~* 'caixa|cef'
        and regexp_replace(coalesce(p_fonte_id,''), '\D', '', 'g') <> ''
        and length(trim(coalesce(p_estado,''))) = 2)
  or (public.doc_arquivo(p_link) and p_link !~* 'matricula\.asp')
  or exists (select 1 from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) x
              where (x->>'tipo' ilike '%matricula%' or x->>'nome' ilike '%matr%')
                and public.doc_arquivo(x->>'url'))
  or exists (select 1 from public.imovel_anexos a
              where a.imovel_id = p_id
                and (a.tipo ilike '%matricula%' or a.nome ilike '%matr%')
                and public.doc_arquivo(a.url));
$$;

-- Os dois sinais passam a ser mantidos pelo MESMO gatilho.
create or replace function public.trg_set_tem_edital_doc()
returns trigger language plpgsql as $$
begin
  new.tem_edital_doc := public.calc_tem_edital_doc(new.id, new.link_edital, new.anexos);
  new.tem_matricula_doc := public.calc_tem_matricula_doc(
    new.id, new.link_matricula, new.anexos, new.fonte, new.estado, new.fonte_id);
  return new;
end;
$$;

drop trigger if exists set_tem_edital_doc on public.imoveis_leilao;
create trigger set_tem_edital_doc
  before insert or update of link_edital, link_matricula, anexos, fonte, estado, fonte_id
  on public.imoveis_leilao
  for each row execute function public.trg_set_tem_edital_doc();

create or replace function public.trg_anexo_atualiza_tem_edital()
returns trigger language plpgsql as $$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo_ed boolean; declare novo_mat boolean;
begin
  if alvo is not null then
    select public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos),
           public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
      into novo_ed, novo_mat
      from public.imoveis_leilao i where i.id = alvo;
    update public.imoveis_leilao i
       set tem_edital_doc = novo_ed, tem_matricula_doc = novo_mat
     where i.id = alvo
       and (i.tem_edital_doc is distinct from novo_ed or i.tem_matricula_doc is distinct from novo_mat);
  end if;
  return null;
end;
$$;

drop trigger if exists anexo_atualiza_tem_edital on public.imovel_anexos;
create trigger anexo_atualiza_tem_edital
  after insert or update or delete on public.imovel_anexos
  for each row execute function public.trg_anexo_atualiza_tem_edital();

update public.imoveis_leilao i
   set tem_matricula_doc = public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
 where i.tem_matricula_doc is distinct from
       public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id);

-- =====================================================================================
-- O INVARIANTE PASSA A MEDIR ENTREGA, NÃO FORMATO DE URL
--
-- `doc_link_sem_documento` (criado em 17/08) testava se a URL termina em '/', '?' ou '#'.
-- Isso é a FORMA do link, não o que o cliente recebe: acusava os 38 lotes da SODRE — que
-- ENTREGAM o edital pelos anexos — e não via os 1.425 da SUPERBID, que não entregam nada.
-- Falso-positivo e falso-negativo na mesma régua, e vermelho diário sobre fonte sadia é
-- como alerta ruidoso vira alerta ignorado.
--
-- Com o selo agora preso aos sinais `tem_*_doc`, a promessa não pode mais mentir. O que
-- passa a valer a pena vigiar é o SINAL sair de sincronia (gatilho removido ou quebrado):
-- um UPDATE que não dispara não dá erro, e o selo voltaria a mentir calado.
--
-- Testado nas DUAS direções antes de ficar: verde=0 no acervo real, e corrompendo à mão
-- um sinal de edital e um de matrícula (em transação desfeita) o invariante foi a 1 e a 2.
-- Invariante que só sabe ficar verde não prova proteção nenhuma.
-- =====================================================================================
do $outer$
declare corpo text; novo text; bloco text;
begin
  select prosrc into corpo from pg_proc where proname='qa_invariantes';

  bloco := '     (''selo_documento_dessincronizado'',''Sinal de edital/matricula-arquivo fora de sincronia com o acervo'',''Documentos'',''bug'',' || chr(10) ||
           '       (select count(*) from imoveis_leilao where ativo' || chr(10) ||
           '         and (tem_edital_doc is distinct from public.calc_tem_edital_doc(id, link_edital, anexos)' || chr(10) ||
           '           or tem_matricula_doc is distinct from public.calc_tem_matricula_doc(id, link_matricula, anexos, fonte, estado, fonte_id))), 0),' || chr(10);

  -- Aceita tanto o invariante ORIGINAL (banco novo, reconstruído das migrações) quanto a
  -- versão intermediária só-edital (banco de produção em 18/08).
  if position('(''doc_link_sem_documento''' in corpo) > 0 then
    novo := regexp_replace(corpo, '\(''doc_link_sem_documento''.*?(?=\(''lote_sem_area_nem_matricula'')', bloco || '     ');
  else
    novo := regexp_replace(corpo, '\(''selo_edital_dessincronizado''.*?(?=\(''lote_sem_area_nem_matricula'')', bloco || '     ');
  end if;

  if novo = corpo then raise exception 'NAO SUBSTITUIU — nenhum dos blocos esperados casou'; end if;
  if position('(''doc_link_sem_documento''' in novo) > 0 then raise exception 'o invariante antigo ainda esta declarado'; end if;
  if position('(''selo_documento_dessincronizado''' in novo) = 0 then raise exception 'o invariante novo nao entrou'; end if;
  if position('(''lote_sem_area_nem_matricula''' in novo) = 0 then raise exception 'comeu o invariante seguinte'; end if;

  execute 'create or replace function public.qa_invariantes() returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) language sql stable as $corpo$' || novo || '$corpo$';
end $outer$;
