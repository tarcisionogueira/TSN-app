-- =====================================================================================
-- GAP #5 — VALIDAÇÃO DE INGESTÃO EXTERNA (classe 10 / forma #8 do CLAUDE.md)
--
-- "CONTAR NÃO-NULOS NÃO É VALIDAR." A ingestão do IBGE gravou ok=true, 5.570 linhas e
-- rotulos_ignorados:[] durante 9 dias trazendo 1 de 4 colunas; e deu número plausível-e-errado
-- por separador decimal (São Paulo 1.521.202 km²), rótulo ambíguo (São Paulo 265 domicílios) e
-- dois rótulos gravando a MESMA coluna (nascimentos=100 no Brasil inteiro). Contagem de
-- preenchidos passou nos quatro. O que pega é validar contra o número que a fonte PUBLICA e
-- contra a coerência interna que dado demográfico REAL sempre respeita.
--
-- Cinco invariantes novos em qa_invariantes(), todos com LIMITE 0 e VERDE no acervo de 21/08
-- (5.570 cidades). Cada um mira uma das quatro formas — calibrados com folga contra a
-- distribuição real para não gritar em cidade sadia (o defeito #5, freio-vira-conteúdo, na
-- versão "trava boa demais"):
--   · ingestao_parcial  — cidade com 1 a 3 das 4 colunas. Exclui de propósito a cidade NOVA
--       (Boa Esperança do Norte/MT: 0 de 4, pós-Censo — placeholder legítimo) e a completa
--       (4 de 4). Pega a "1 de 4".
--   · moradores_por_domicilio — pop/domicílios > 8. Real: máx 5,58. "SP 265 domicílios" = 43.000.
--   · nascimentos_implausivel — nascimentos fora de 0,1%–15% da população. Real: 0,167%–9,79%.
--       "nascimentos=100" p/ SP = 0,0009%. Pega a colisão de rótulo.
--   · densidade_incoerente — |densidade − pop/área| > 10%. Real: 0 fora de 5%. Separador decimal
--       na área (1.000×) desloca a densidade publicada e não fecha mais a conta.
--   · ancora_fora_da_faixa — SP/RJ/DF fora da faixa que qualquer um sabe de cabeça. Pega o erro
--       SISTÊMICO (escala) mesmo que passasse pela coerência interna.
--
-- Não cobre marketing_metricas_dia (admin-facing, outra prioridade) nem toda fonte externa — a
-- REGRA vale para a classe: ao ingerir fonte nova, ancore num caso conhecido de cabeça.
--
-- Idempotente e via cirurgia de string sobre o prosrc VIVO (mesmo idioma de
-- selo_matricula_so_com_arquivo.sql): não retranscreve o corpo de 300 linhas e vale tanto no
-- banco de produção quanto no reconstruído das migrações.
-- =====================================================================================
do $outer$
declare corpo text; novo text; bloco text;
begin
  select prosrc into corpo from pg_proc where proname = 'qa_invariantes';
  if corpo is null then raise exception 'qa_invariantes nao existe'; end if;

  -- Já aplicado? (idempotência)
  if position('socio_ancora_fora_da_faixa' in corpo) > 0 then return; end if;

  -- Âncora de inserção: o último invariante da lista.
  if position('(''lote_sem_area_nem_matricula''' in corpo) = 0 then
    raise exception 'ancora (lote_sem_area_nem_matricula) nao encontrada em qa_invariantes';
  end if;

  bloco := $blk$     ('socio_ingestao_parcial','Censo: cidade com 1 a 3 das 4 colunas (pop/area/domicilios/nascimentos)','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade'
          and (case when populacao   is not null then 1 else 0 end
             + case when area_km2    is not null then 1 else 0 end
             + case when domicilios  is not null then 1 else 0 end
             + case when nascimentos is not null then 1 else 0 end) between 1 and 3), 0),
     ('socio_moradores_por_domicilio','Censo: moradores por domicilio absurdo (>8) — rotulo trocado','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(domicilios,0)>0 and coalesce(populacao,0)>0
          and populacao::numeric/domicilios > 8), 0),
     ('socio_nascimentos_implausivel','Censo: nascimentos fora de 0,1%-15% da populacao — colisao de rotulo','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(populacao,0)>0 and nascimentos is not null
          and (nascimentos < populacao*0.001 or nascimentos > populacao*0.15)), 0),
     ('socio_densidade_incoerente','Censo: densidade nao bate com populacao/area (>10%) — separador decimal','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(area_km2,0)>0 and coalesce(populacao,0)>0
          and abs(densidade_hab_km2 - populacao::numeric/area_km2) > 0.10*(populacao::numeric/area_km2)), 0),
     ('socio_ancora_fora_da_faixa','Censo: cidade-ancora (SP/RJ/DF) fora da faixa publicada','Ingestao','bug',
       (select count(*) from (values
           ('saopaulo','SP',10000000,13000000,1400,1650),
           ('riodejaneiro','RJ',5500000,7000000,1100,1300),
           ('brasilia','DF',2500000,3200000,5200,6100)
         ) a(cn,uf,pmin,pmax,amin,amax)
         join cidade_socio c on c.cidade_norm=a.cn and c.uf=a.uf and c.nivel='cidade'
         where c.populacao not between a.pmin and a.pmax or c.area_km2 not between a.amin and a.amax), 0),
$blk$;

  novo := replace(corpo, '(''lote_sem_area_nem_matricula''', bloco || '     (''lote_sem_area_nem_matricula''');
  if novo = corpo then raise exception 'NAO SUBSTITUIU — replace nao alterou o corpo'; end if;
  if position('socio_ancora_fora_da_faixa' in novo) = 0 then raise exception 'invariantes novos nao entraram'; end if;
  if position('(''lote_sem_area_nem_matricula''' in novo) = 0 then raise exception 'comeu o invariante seguinte'; end if;

  execute 'create or replace function public.qa_invariantes() returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) language sql stable as $corpo$' || novo || '$corpo$';
end $outer$;
