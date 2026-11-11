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
import ares from './fontes/ares.mjs';
import suportev2 from './fontes/suportev2.mjs';
// 26/10: fronts Next.js novos da Suporte (LanceVIP: carros/motos/caminhões; VIX: veículos dos eventos abertos).
import lancevip from './fontes/lancevip.mjs';
import vixleiloes from './fontes/vixleiloes.mjs';
// Portal dos Leilões (26/10): só lote ABERTO dos leilões que o site declara abertos, com gate de cobertura ≥ 90%.
import portaldosleiloes from './fontes/portaldosleiloes.mjs';
// 05/11: os 34+ leiloeiros da plataforma Degrau (Leilão Eletrônico, Destak, Taba, GF…) — mesmo feed dos imóveis.
import leilaoeletronico from './fontes/leilaoeletronico.mjs';
// 11/11: Klöckner (kleiloes.com.br) virou fonte própria — os veículos saíam pelo jeleiloes, no template antigo.
import kleiloes from './fontes/kleiloes.mjs';

export const FONTES_VEICULOS = [freitas, globo, leilaobrasil, mgl, jeleiloes, kleiloes, simon, nakakogue, ares, suportev2, vixleiloes, lancevip, portaldosleiloes, leilaoeletronico];
