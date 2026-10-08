// Teste do endereço do GRUPOLANCE pela seção "Localização" (#88). Blocos reais do recon de 08/10.
import { localizacaoGrupoLance } from '../lib/grupolance-localizacao.mjs';

let ok = 0, falhou = 0;
const bloco = (t) => `<h2 class="section-title mt-5">Localização</h2>\r\n                <div class="mb-3">\r\n                     ${t}                </div>\r\n <iframe src="x">`;
const caso = (nome, html, esperado) => {
  const r = localizacaoGrupoLance(html);
  if (JSON.stringify(r) === JSON.stringify(esperado)) ok++;
  else { falhou++; console.log(`✗ ${nome}\n  esperado ${JSON.stringify(esperado)}\n  veio     ${JSON.stringify(r)}`); }
};

caso('rua + bairro', bloco('Rua Brasília, Jardim Santa Eliza V, Barra Bonita, SP'), { endereco: 'Rua Brasília', bairro: 'Jardim Santa Eliza V' });
caso('só rua', bloco('Rua Libório Monaldo Stillitano, Sorocaba, SP'), { endereco: 'Rua Libório Monaldo Stillitano', bairro: '' });
caso('acesso + bairro', bloco('Acesso Florenal Ribeiro, Santos Dumont, Chapecó, SC'), { endereco: 'Acesso Florenal Ribeiro', bairro: 'Santos Dumont' });
caso('número fica no endereço', bloco('Rua Amapá, 233, Vila Santa Rosa, Mococa, SP'), { endereco: 'Rua Amapá, 233', bairro: 'Vila Santa Rosa' });
caso('só número, sem bairro', bloco('Rua Rio Grande do Sul, 946, Estrela D\'Oeste, SP'), { endereco: 'Rua Rio Grande do Sul, 946', bairro: '' });
caso('complemento no endereço', bloco('Rua Francisco Rebolo, 40, Ed. Ponta do Arpoador, Apto 73, Enseada, Guarujá, SP'), { endereco: 'Rua Francisco Rebolo, 40, Ed. Ponta do Arpoador, Apto 73', bairro: 'Enseada' });
caso('só cidade não inventa', bloco('Lençóis Paulista, SP'), null);
caso('bairro sem via não vira rua', bloco('Jardim Europa, Sorocaba, SP'), null);
caso('sem bloco', '<html><body>nada</body></html>', null);

console.log(`${falhou ? '✗' : '✓'} ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
