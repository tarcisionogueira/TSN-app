// Teste dos leitores de endereço por bloco da página (#88). Trechos reais do recon de 08/10.
import { enderecoHastaPublica, enderecoSoleon } from '../lib/endereco-pagina.mjs';

let ok = 0, falhou = 0;
const caso = (nome, r, esperado) => {
  if (JSON.stringify(r) === JSON.stringify(esperado)) ok++;
  else { falhou++; console.log(`✗ ${nome}\n  esperado ${JSON.stringify(esperado)}\n  veio     ${JSON.stringify(r)}`); }
};
const hasta = (s) => `<script> socketserver="x"; endereco=new Array("${s}","0.00","0.00"); g_a="1";</script>`;
const soleon = (end, cid, cep) => `<h5>Localização do Imóvel</h5> <div class="mb-3 p-2 border rounded"> <p> <b>Endereço:</b> ${end} <br><b>Cidade:</b> ${cid} - <b>CEP:</b> ${cep} </p>`;

caso('hasta rua+nº+bairro', enderecoHastaPublica(hasta('Rua Sergipe, 285 -  Parque Varotti -  - Santa Cruz das Palmeiras/SP - Brasil')), { endereco: 'Rua Sergipe, 285', bairro: 'Parque Varotti' });
caso('hasta loteamento', enderecoHastaPublica(hasta('Rua Polônia, lotes 01 e 09 – quadra 06 - Loteamento Residencial Jardim Europa - - Casca/RS - Brasil')), { endereco: 'Rua Polônia, lotes 01 e 09 – quadra 06', bairro: 'Loteamento Residencial Jardim Europa' });
caso('hasta endereço com hífens não inventa bairro', enderecoHastaPublica(hasta('Quadra SCLN 204 - Bloco D - Loja 55 – ASA NORTE -  - Brasília/DF - Brasil')), { endereco: 'Quadra SCLN 204 - Bloco D - Loja 55 – ASA NORTE', bairro: '' });
caso('hasta só cidade', enderecoHastaPublica(hasta(' -  -  - Jaú/SP - Brasil')), null);
caso('hasta sem script', enderecoHastaPublica('<html></html>'), null);
caso('soleon rua+bairro+cep', enderecoSoleon(soleon('Avenida Picadilly - Alphaville - Lagoa dos Ingleses', 'Nova Lima / MG', '34018-004')), { endereco: 'Avenida Picadilly', bairro: 'Alphaville - Lagoa dos Ingleses', cep: '34018-004' });
caso('soleon zona rural sem rua guarda só cep', enderecoSoleon(soleon('- Area Rural De Santa Rita', 'Santa Rita / PB', '58303-699')), { endereco: '', bairro: 'Area Rural De Santa Rita', cep: '58303-699' });
caso('soleon A. Rural não é rua', enderecoSoleon(soleon('A. Rural - Área Rural De Igarassu', 'Igarassu / PE', '53659-899')), { endereco: '', bairro: 'Área Rural De Igarassu', cep: '53659-899' });
caso('soleon endereço vazio não pega a cidade', enderecoSoleon('<h5>Localização do Imóvel</h5><p><b>Endereço:</b> <br><b>Cidade:</b> Cachoeira da Prata / MG - <b>CEP:</b> 35765-000 </p>'), { endereco: '', bairro: '', cep: '35765-000' });
caso('soleon sem bloco', enderecoSoleon('<div><b>Endereço:</b> Rua X <br></div>'), null);

console.log(`${falhou ? '✗' : '✓'} ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
