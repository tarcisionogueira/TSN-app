-- 09/11: lote Teles & Lima 21554 (Lote 07 Qd J, Alphaville Feira de Santana). Pino estava no centro da cidade.
-- Coordenada do loteamento pelo Nominatim (OSM way 1474014877, "Alphaville, Pampalona, Feira de Santana"),
-- o mesmo passo POI-condomínio da cascata (api/_geo.js). Nível 'bairro': é o centro do loteamento, não o lote.
update imoveis_leilao
   set latitude = -12.2842580, longitude = -39.0068677, geocod_nivel = 'bairro',
       geocod_reproc_em = now(), pontos_proximos = null, proximidades_em = null
 where id = '42989cdf-afbf-458a-8fbd-09eb4010f910';
