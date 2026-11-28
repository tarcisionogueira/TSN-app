-- 28/11: ANANDALEILOES — 26 imóveis (apto, casa, cobertura, lote, fração ideal, área rural) e 1 peça ("10 portas para
-- veículo") gravados em veiculos_leilao como "carro" entre 17 e 23/11. A regra ehVeiculoInteiro foi corrigida no mesmo
-- trabalho (scripts/lib/veiculo-do-lote.mjs). Desativa (reversível), não apaga. Conferido antes: 27 linhas, nenhuma
-- delas veículo de verdade (o Gol 24493 e os Carro Forte ficam).
update public.veiculos_leilao set ativo = false
 where fonte = 'ANANDALEILOES' and ativo
   and (titulo ~* '(apto|apartamento|casa\s+(de|com)|cobertura|lote\s+(c/|de|urbano|murado)|terreno|oportunidade|fração|hectares)'
        or titulo ~* '^10 portas para ve');

-- Mesmo defeito na SARAIVALEILOES (mesma leiloeira e plataforma: 35 imóveis) e 1 na SUPORTE ("VENDA DIRETA DE IMÓVEL
-- RURAL"). Só linhas SEM marca, com o mesmo critério de imóvel. Conferido antes: 35 + 1.
update public.veiculos_leilao set ativo = false
 where ativo and marca is null and fonte in ('SARAIVALEILOES', 'SUPORTE')
   and titulo ~* '(\mapto\M|apartamento|casa\s+(de|com|t[ée]rrea)|cobertura\s+(duplex|triplex)|lote\s+(c/|urbano|murado|de\s+\d+[.,]?\d*\s*m)|\mterreno\M|fração ideal|hectares|im[óo]vel)';
