-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A PRAÇA É UM INTERVALO, E O SCHEMA SÓ GUARDAVA UM PONTO — 28/08
--
-- O edital publica início E fim de cada praça: "o 2º Leilão terá início no dia 20/08/2026 às
-- 14:31 h e se encerrará no dia 10/09/2026 às 14:30 h". Havia UM campo por praça, então
-- metade da informação se perdia — e a metade perdida era justamente a que o sistema inteiro
-- consome: `data_fim` alimenta o gate do relatório, o cron de desativação e a ordenação da
-- busca, e os três perguntam "até quando dá para dar lance?".
--
-- ENQUANTO O CAMPO ERA UM SÓ, NÃO HAVIA LEITOR BOM O BASTANTE. A regex pegava a primeira data
-- da janela (`jan.match()` devolve a primeira ocorrência) — sempre o início. E o prompt da IA
-- pedia {"ordem":2,"data":"AAAA-MM-DD"} sem dizer se era início ou fim, então devolvia o que
-- qualquer leitor humano chamaria de "a data do 2º leilão": também o início. Trocar o modelo
-- não consertaria nada — não existia onde escrever a resposta certa.
--
-- O CASO QUE ORIGINOU: apartamento em Vila Galvão/Guarulhos (MEGA). O scraper capturou o
-- prazo CORRETO (10/09/2026 14:30). A leitura do edital o substituiu por 17/08 e deixou o
-- rastro em relatorio_anomalias: "Acervo dizia 2026-09-10T14:30:00-03:00; edital diz
-- 2026-08-17 — corrigido pelo documento". O acervo estava certo. `data_fim` desabou para
-- 20/08, o lote saiu do ar e o relatório do dono voltou "leilão encerrado em 19/08" — com 13
-- dias de pregão pela frente. Em 25/08 o mesmo padrão (31/08 → 26/08): as duas divergências
-- moveram a data PARA TRÁS, porque o início é sempre anterior ao fim. Viés sistemático.
--
-- `data_leilao` e `data_leilao_2` seguem sendo o INÍCIO de cada praça — é o que a ficha mostra
-- e o que os leiloeiros publicam na listagem. As colunas novas carregam o encerramento, e só
-- são preenchidas quando o DOCUMENTO diz que aquilo é um encerramento; nunca deduzidas.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.imoveis_leilao
  add column if not exists praca1_fim timestamptz,
  add column if not exists praca2_fim timestamptz;

comment on column public.imoveis_leilao.praca1_fim is
  'Encerramento da 1a praca, quando o edital publica o intervalo. NULL = o documento nao disse (nunca deduzir).';
comment on column public.imoveis_leilao.praca2_fim is
  'Encerramento da 2a praca — na pratica o ULTIMO instante em que se aceita lance no lote. Alimenta data_fim.';

-- `data_fim` continua sendo "a maior data conhecida". O que muda é que agora existe uma data
-- maior para conhecer — e ela é a única que responde à pergunta que o negócio faz.
create or replace function public.trg_data_fim_leilao()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  new.data_fim := greatest(
    new.praca2_fim::date,
    new.praca1_fim::date,
    new.data_leilao_2::date,
    public.data_leilao_para_date(new.data_leilao)
  );
  if new.praca2_fim is null and new.praca1_fim is null
     and new.data_leilao_2 is null
     and public.data_leilao_para_date(new.data_leilao) is null then
    new.data_fim := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_data_fim_leilao on public.imoveis_leilao;
create trigger trg_data_fim_leilao
  before insert or update of data_leilao, data_leilao_2, praca1_fim, praca2_fim
  on public.imoveis_leilao
  for each row execute function public.trg_data_fim_leilao();
