/**
 * Fontes do motor que TAMBÉM têm veículos (21/10). Cada config declara `veiculos: { catalogo, … }`
 * no próprio arquivo de fonte — aqui só a lista do que scraper-veiculos-motor.mjs percorre, na ordem
 * do tamanho do buraco medido na varredura de 21/10 (maior primeiro).
 */
import freitas from './fontes/freitas.mjs';
import mgl from './fontes/mgl.mjs';
import simon from './fontes/simon.mjs';
import jeleiloes from './fontes/jeleiloes.mjs';
import nakakogue from './fontes/nakakogue.mjs';
import globo from './fontes/globo.mjs';
import leilaobrasil from './fontes/leilaobrasil.mjs';

export const FONTES_VEICULOS = [freitas, globo, leilaobrasil, mgl, jeleiloes, simon, nakakogue];
