-- ZUK: resultados gravados pelo leitor GENÉRICO voltam para a fila (24/09/2026). O recon de páginas
-- reais mostrou 'vendido' falso antes do pregão (cláusula "o Arrematante…" + R$ por perto) e nenhum
-- "sem lance" reconhecido. `api/_resultado-leilao.js` ganhou leitor próprio da ZUK (painel "Maior
-- lance até agora" + "Este leilão já foi encerrado"); os 77 resultados ZUK (todos na janela de 10
-- dias) são relidos por ele. "Não apurado" é honesto; "vendido" falso não é.
update public.imoveis_leilao
   set resultado_leilao = null, valor_lance_vencedor = null, resultado_apuracao_tentativas = 0, resultado_apurado_em = null
 where fonte = 'ZUK' and resultado_leilao is not null;
