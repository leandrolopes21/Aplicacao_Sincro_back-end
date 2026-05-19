const express = require('express');
const multer = require('multer');
const cors = require('cors');
const xlsx = require('xlsx'); // A nova biblioteca para Excel/CSV

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

const upload = multer({ storage: multer.memoryStorage() });

// Mudamos o nome do campo de 'arquivoPdf' para 'arquivoExtrato'
app.post('/api/taxas', upload.single('arquivoExtrato'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
        }

        // Lê o arquivo Excel/CSV diretamente da memória
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // Pega a primeira aba
        const worksheet = workbook.Sheets[sheetName];

        // Converte a planilha para uma matriz (Array de Arrays)
        // raw: false garante que datas e valores venham formatados como texto legível
        const dadosBrutos = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false });

        // Procura em qual linha está o cabeçalho oficial (para ignorar as linhas vazias do topo)
        let cabecalhoIndex = dadosBrutos.findIndex(linha => linha[0] === 'Data' || linha[1] === 'Transação');
        
        if (cabecalhoIndex === -1) {
            return res.status(400).json({ erro: 'Formato de planilha inválido. Cabeçalhos não encontrados.' });
        }

        const cabecalho = dadosBrutos[cabecalhoIndex];
        const linhasDeDados = dadosBrutos.slice(cabecalhoIndex + 1);

        let totalTaxas = 0;
        let quantidadeTaxas = 0;
        let estruturaPorData = {};

        // Varre linha por linha da planilha
        linhasDeDados.forEach(linha => {
            if (linha.length === 0) return; // Pula linhas vazias

            const data = linha[cabecalho.indexOf('Data')];
            const descricao = linha[cabecalho.indexOf('Descrição')];
            const valorRaw = linha[cabecalho.indexOf('Valor')];

            if (!data || !descricao || !valorRaw) return;

            // Transforma o valor numérico para a nossa matemática
            const valorFloat = parseFloat(valorRaw.replace(',', '.'));

            // Se o valor for negativo e menor que a nossa regra (R$ 10)
            if (!isNaN(valorFloat) && valorFloat < 0 && valorFloat > -10) {
                // Invertemos para positivo para somar nos totais
                const valorTaxa = Math.abs(valorFloat);

                totalTaxas += valorTaxa;
                quantidadeTaxas++;

                // Extrai o nome do cliente direto da descrição (ex: "Taxa de boleto - fatura nr. 803399917 LS HOME CARE LTDA")
                let cliente = "Cliente Desconhecido";
                const matchNome = descricao.match(/fatura\s+nr\.?\s*\d+\s+(.*)/i);
                if (matchNome && matchNome[1]) {
                    cliente = matchNome[1].trim();
                }

                // Pega só o primeiro nome
                const clienteCurto = cliente.split(' ')[0];

                // Agrupa os dados
                if (!estruturaPorData[data]) {
                    estruturaPorData[data] = { totalDia: 0, clientes: {} };
                }
                
                estruturaPorData[data].totalDia += valorTaxa;
                
                if (!estruturaPorData[data].clientes[clienteCurto]) {
                    estruturaPorData[data].clientes[clienteCurto] = 0;
                }
                estruturaPorData[data].clientes[clienteCurto] += valorTaxa;
            }
        });

        // Formatação para o Front-end
        const detalhesPorData = Object.keys(estruturaPorData).map(data => {
            const grupo = estruturaPorData[data];
            const listaClientes = Object.keys(grupo.clientes).map(nome => ({
                nome: nome,
                totalFormatado: grupo.clientes[nome].toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            }));

            return {
                data: data,
                totalDiaFormatado: grupo.totalDia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                clientes: listaClientes
            };
        });

        res.json({
            quantidade: quantidadeTaxas,
            totalFormatado: totalTaxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL'}),
            taxasPorData: detalhesPorData
        });

    } catch (error) { 
        console.error('Erro na API:', error);
        res.status(500).json({ erro: 'Erro interno ao processar a planilha.' });
    }
});

const PORTA = process.env.PORT || 3001;
app.listen(PORTA, () => {
    console.log(`Back-end (API) rodando na porta ${PORTA}`);
});