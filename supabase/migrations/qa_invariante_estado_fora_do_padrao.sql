-- ─────────────────────────────────────────────────────────────────────────────────────────
-- INVARIANTE: lote ativo com `estado` fora do padrão de sigla — 26/08/2026
--
-- POR QUE EXISTE. O dono olhou o novo /leiloes e perguntou: "por que aparece como sem lotes,
-- se temos lotes no acervo?". Naquele caso a resposta era inocente (a prévia usava dados
-- fictícios), mas a pergunta expôs um caminho REAL pelo qual lote some da página pública sem
-- que nada apite — e esse caminho não tinha vigia nenhum.
--
-- O CAMINHO. `api/publico.js` monta o índice nacional casando o retorno de
-- `acervo_uf_contagem()` com a tabela de siglas `UF_NOME` (`.filter(r => UF_NOME[r.uf])`).
-- A RPC faz `upper(estado)` e agrupa. Então um lote gravado como `São Paulo`, `Sao Paulo` ou
-- `sp ` (com espaço à direita) é CONTADO pela RPC e DESCARTADO pela página:
--
--   • não pertence a estado nenhum na tela;
--   • o total anunciado no topo sai menor que o acervo;
--   • o estado pode aparecer como "sem lote hoje" TENDO lote;
--   • e nada disso levanta erro, log ou exceção — o `filter` só devolve menos itens.
--
-- `acervo_cidades_uf(p_uf)` tem o mesmo ponto cego: `upper(estado) = upper(p_uf)` nunca casa
-- `São Paulo` com `SP`, então a cidade também desaparece da lista da UF.
--
-- É a forma de falha nº 3 e nº 9 do CLAUDE.md com outra roupa: filtro que remove linhas NÃO é
-- erro, e o resultado menor chega ao cliente com cara de resposta completa. Revisão de código
-- não pega, teste de front não pega, o build passa — o defeito mora no DADO.
--
-- LIMITE 0, de propósito. Aqui não existe "pouco é tolerável": uma única linha significa lote
-- invisível na página pública. Se nascer vermelho, o conserto é em três passos, nesta ordem:
--   1. normalizar na ORIGEM (o parser do leiloeiro que gravou assim) — senão volta amanhã;
--   2. backfill das linhas existentes;
--   3. só então o invariante fecha em zero e passa a ser vigia, não relatório.
--
-- ⚠️ NÃO CONFERIDO CONTRA O BANCO. A sessão de 26/08 ficou sem acesso ao Supabase
-- ("You do not have permission to perform this action" em toda consulta), então não sei se o
-- acervo tem hoje 0 ou 3.000 linhas assim. O invariante foi escrito para responder essa
-- pergunta sozinho, todo dia, em vez de depender de alguém lembrar de perguntar.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Edição cirúrgica de `qa_invariantes()` (a lista de VALUES é hardcoded; inserir uma linha sem
-- reescrever as outras evita transcrever o corpo inteiro e errar uma delas). Idempotente, e
-- ABORTA se a âncora não existir — se alguém reescrever a função, isto falha alto em vez de
-- aplicar no lugar errado.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';
  if def is null then
    raise exception 'qa_invariantes() nao encontrada';
  end if;

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('estado_fora_do_padrao','Lote ativo com estado que nao e sigla de 2 letras (some de /leiloes)','Captura','bug',
       (select count(*) from imoveis_leilao
         where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$')), 0)$b$;

  if position(antes in def) = 0 then
    -- Já aplicado, ou a função mudou. Nos dois casos, não mexer é o certo.
    if position('estado_fora_do_padrao' in def) > 0 then
      raise notice 'invariante ja presente — nada a fazer';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes() — revise antes de aplicar';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com estado_fora_do_padrao';
end $do$;

-- Conferência depois de aplicar (verde = 0):
--   select * from public.qa_invariantes() where chave = 'estado_fora_do_padrao';
-- E, se vier vermelho, o detalhe de QUEM gravou errado:
--   select fonte, coalesce(estado,'(nulo)') as estado_gravado, count(*)
--     from imoveis_leilao where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$')
--    group by 1,2 order by 3 desc;
