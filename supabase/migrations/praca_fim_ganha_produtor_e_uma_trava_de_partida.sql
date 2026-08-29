-- 29/08 — P1: `praca1_fim`/`praca2_fim` EXISTIAM E NINGUÉM AS PREENCHIA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- As colunas nasceram em 28/08 (`praca_fim_prazo_real_de_lance.sql`) para desfazer a
-- conflação que tirou do ar um lote com 13 dias de pregão pela frente. Um dia depois:
-- **1 lote em 30.622** as tinha — e era o que foi preenchido À MÃO. Cinco arquivos citavam
-- as colunas (`enviar-alertas-cron`, `gerar-analise`, `_leilao-encerrado`, `leilaoEncerrado.js`,
-- `ImovelDetalhe.jsx`) e **todos eram CONSUMIDORES**. Forma nº 7 pelo avesso: o schema
-- chegou, o produtor não.
--
-- ─── A CAUSA, QUE ESTAVA A UMA LINHA DE DISTÂNCIA ───────────────────────────────────────
-- Os três produtores de data (`enriquecer-lote` ×2 e `_doc-datas`) faziam:
--
--     if (fim && !im.data_leilao_2) patch.data_leilao_2 = fim;
--
-- `data_leilao_2` é, pelo schema, o **INÍCIO** da 2ª praça. E `datas.fim` vinha de um
-- `CTX_FIM` que casa DUAS coisas incompatíveis:
--
--     /encerr|término|fim d|final d|limite|até |fechamento     ← ENCERRAMENTO de verdade
--     |2[ªa°]?\s*praça|segunda\s*praça/                        ← ABERTURA da 2ª praça
--
-- Ou seja: um encerramento era gravado numa coluna de início, e as colunas criadas para
-- recebê-lo nunca viam nada. `CTX_FIM` foi separado em `CTX_ENCERRAMENTO` e `CTX_PRACA_2`,
-- e `extrairDatasLeilao` passa a devolver os dois valores distintos. O roteamento vive numa
-- função só (`roteiarDatasPraca`) usada pelos três chamadores — a regra em três cópias foi
-- justamente o que deixou o defeito passar em todas.
--
-- ⚠️ **`data_fim` NÃO muda de valor.** O trigger `trg_data_fim_leilao` já faz
-- `greatest(praca2_fim, praca1_fim, data_leilao_2, data_leilao)`. O prazo continua o mesmo;
-- o que muda é a coluna que o carrega passar a dizer a verdade sobre o que ele é. Era a
-- propriedade que tornava esta correção segura de fazer no acervo inteiro.
--
-- A qual praça o encerramento pertence sai da ORDEM, e só quando a ordem sustenta: antes da
-- abertura da 2ª praça fecha a 1ª; a partir dela, fecha a 2ª; sem 2ª praça conhecida, é da
-- praça única. **Havendo 2ª praça cuja abertura não se consegue ler, não grava nada** — a
-- migração de 28/08 é explícita, praça_fim nunca é deduzida, e coluna vazia é honesta
-- enquanto coluna preenchida errada não levanta suspeita de ninguém.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- TRAVA DE PARTIDA — "o produtor chegou a produzir?"
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Honestidade sobre o que este invariante é: **um cheque de PARTIDA, não vigilância
-- contínua.** Ele acusa enquanto o acervo inteiro tiver no máximo o lote preenchido à mão, e
-- zera assim que o pipeline gravar o segundo. Depois disso não volta a acusar sozinho (os
-- valores já gravados permanecem), e isso é deliberado: o defeito que ele existe para pegar
-- é exatamente o do P1 — uma coluna que entra em produção e fica esperando um produtor que
-- ninguém escreveu. Esse estado durou de 28/08 até hoje sem nada acusar.
--
-- O par que faz a vigilância CONTÍNUA já existe desde 28/08 e continua valendo:
-- `praca_fim_antes_do_inicio` e `praca2_antes_da_praca1` pegam o dado incoerente depois que
-- ele começa a entrar.
create or replace function public.qa_invariante_praca_fim_sem_produtor()
returns bigint language sql stable set search_path to 'public' as $$
  select case when (
    select count(*) from public.imoveis_leilao
     where praca1_fim is not null or praca2_fim is not null
  ) <= 1 then 1 else 0 end::bigint;
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('praca_fim_sem_produtor' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''praca_fim_sem_produtor'',''Colunas praca1_fim/praca2_fim em producao sem NENHUM produtor gravando (schema chegou, produtor nao)'',''Captura'',''bug'',\n       public.qa_invariante_praca_fim_sem_produtor(), 0)';
  execute replace(d, alvo, novo);
end $do$;
