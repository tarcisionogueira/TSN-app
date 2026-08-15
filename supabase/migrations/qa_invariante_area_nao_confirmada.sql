-- INVARIANTE NOVO: relatório de mercado calculado sobre metragem NÃO confirmada na matrícula.
--
-- POR QUE (15/08, achado do dono num relatório de Morada dos Pinheiros). O lote foi anunciado
-- com 396 m² (área do TERRENO); a matrícula descreve casa de 236 m². Sem ler o documento, o
-- mercadológico usou 396, viu que os comparáveis da região não fechavam com esse tamanho e
-- imprimiu "cerca de 129 m² privativos" — número que é `avaliação ÷ R$/m²`, uma conta, não
-- uma medida. O cliente leu como leitura de documento, que é como qualquer um leria.
--
-- O DADO QUE MOSTRA QUE NÃO ERA CASO ISOLADO: 28.355 lotes ativos têm matrícula disponível e
-- 5 tinham a área lida; NENHUM relatório de mercado já emitido tem
-- `metodologia.area.fonte = 'matricula'`. O caminho "confirmar a metragem antes de pesquisar"
-- existia desde 06/08 e nunca chegou a rodar em produção — porque o regex só enxerga PDF com
-- camada de texto e ninguém media a taxa de sucesso dele.
--
-- É POR ISSO QUE O INVARIANTE OLHA O DESFECHO, e não o código: o valor de mercado inteiro
-- pendura na metragem, e "não consegui ler a matrícula" é indistinguível, no relatório
-- pronto, de "li e confere". O limite 2 tolera o lote cuja matrícula genuinamente não abre;
-- 15 em 7 dias, que é o estado de hoje, é o sintoma que se quer ver desaparecer.
do $$
declare def text; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc
   where proname = 'qa_invariantes' and pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'qa_invariantes() não encontrada'; end if;
  -- Idempotente: se a chave já está lá, não duplica.
  if position('relatorio_area_nao_confirmada' in def) > 0 then return; end if;

  novo := $q$     ('relatorio_area_nao_confirmada','Mercado calculado sobre área não confirmada na matrícula','Relatório','bug',
       (select count(*) from analises_mercado a
          join imoveis_leilao i on i.id::text = a.imovel_id::text
         where a.status = 'concluida' and a.created_at > now() - interval '7 days'
           and coalesce(a.result->'mercado'->'metodologia'->'area'->>'fonte','') <> 'matricula'
           and (i.link_matricula is not null or i.anexos::text like '%"matricula"%')), 2),
$q$;
  def := replace(def, '     (''aval_ausente_com_doc''', novo || '     (''aval_ausente_com_doc''');
  execute def;
end $$;
