const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const TOKEN = '8681495832:AAG779hPXztaTXxwQlx5JQm1bZ3bSWrshes';
const dbPath = path.join(__dirname, 'database.sqlite');
const alertsFile = path.join(__dirname, 'telegram-admins.json');

// Carrega admin chats do arquivo
function loadAdmins() {
    try {
        if (fs.existsSync(alertsFile)) {
            return JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveAdmins(admins) {
    fs.writeFileSync(alertsFile, JSON.stringify(admins, null, 2));
}

let adminChats = loadAdmins();

let db;

async function initDB() {
    try {
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        console.log('✅ Banco SQLite conectado');

        // Cria tabela de checklists se não existir
        await db.exec(`
            CREATE TABLE IF NOT EXISTS checklists (
                id TEXT PRIMARY KEY,
                veiculoId TEXT,
                motoristaId TEXT,
                data TEXT,
                pneus INTEGER,
                oleo INTEGER,
                agua INTEGER,
                freios INTEGER,
                farois INTEGER,
                triangulo INTEGER,
                observacoes TEXT
            )
        `);
        console.log('✅ Tabela checklists verificada');
    } catch (err) {
        console.error('❌ Erro ao conectar banco:', err.message);
    }
}

console.log('🤖 Iniciando bot do Telegram...');
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    console.error('❌ Erro no polling:', error.message);
});

bot.on('error', (error) => {
    console.error('❌ Erro no bot:', error.message);
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
        `🚌 *Transpbussines Bot*\n\n` +
        `Comandos disponíveis:\n` +
        `/combustivel [placa] - Ver abastecimentos\n` +
        `/rota [placa] - Ver rotas do dia\n` +
        `/saldo [motorista] - Ver saldo a receber\n` +
        `/km [placa] [valor] - Atualizar hodômetro\n` +
        `/abastecer [placa] [litros] [valor_total] [km]\n\n` +
        `Envie fotos de cupons para registro rápido.`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/combustivel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const placa = match[1].toUpperCase();

    try {
        const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa);
        if (!vehicle) {
            return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
        }

        const fuelRecords = await db.all(
            `SELECT * FROM fuel WHERE veiculoId = ? ORDER BY data DESC LIMIT 10`,
            vehicle.id
        );

        if (fuelRecords.length === 0) {
            return bot.sendMessage(chatId, `⛽ Nenhum abastecimento encontrado para ${placa}.`);
        }

        let totalLiters = 0, totalValue = 0;
        let response = `⛽ *Abastecimentos - ${placa}*\n\n`;

        for (const rec of fuelRecords) {
            totalLiters += rec.litros || 0;
            totalValue += rec.valorTotal || 0;
            response += `📅 ${rec.data}\n`;
            response += `   ${rec.litros}L × R$ ${rec.valorLitro} = R$ ${rec.valorTotal}\n`;
            response += `   KM: ${rec.kmAbastecimento || 'N/A'}\n\n`;
        }

        response += `📊 *Total:* ${totalLiters.toFixed(1)}L | R$ ${totalValue.toFixed(2)}`;

        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao consultar abastecimentos.');
    }
});

bot.onText(/\/rota (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const placa = match[1].toUpperCase();

    try {
        const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa);
        if (!vehicle) {
            return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
        }

        const today = new Date().toISOString().split('T')[0];
        const routes = await db.all(
            `SELECT * FROM routes WHERE veiculoId = ? AND data = ?`,
            vehicle.id, today
        );

        if (routes.length === 0) {
            return bot.sendMessage(chatId, `📍 Nenhuma rota para ${placa} hoje.`);
        }

        let response = `🗺️ *Rotas Hoje - ${placa}*\n\n`;
        for (const route of routes) {
            response += `📍 ${route.origem} → ${route.destino}\n`;
            response += `   KM: ${route.km || 'N/A'} | Frete: R$ ${route.valorFrete || 0}\n\n`;
        }

        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao consultar rotas.');
    }
});

bot.onText(/\/saldo (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const driverName = match[1];

    try {
        const driver = await db.get(
            'SELECT * FROM drivers WHERE UPPER(nome) LIKE UPPER(?) AND ativo = 1',
            `%${driverName}%`
        );

        if (!driver) {
            return bot.sendMessage(chatId, `❌ Motorista "${driverName}" não encontrado.`);
        }

        const pendingRoutes = await db.all(
            `SELECT SUM(valorFrete) as total FROM routes WHERE motoristaId = ?`,
            driver.id
        );

        const advances = await db.all(
            `SELECT SUM(valor) as total FROM adiantamentos WHERE motoristaId = ?`,
            driver.id
        );

        const totalRoutes = pendingRoutes[0].total || 0;
        const totalAdvances = advances[0].total || 0;
        const balance = totalRoutes - totalAdvances;

        let response = `💰 *Saldo - ${driver.nome}*\n\n`;
        response += `📦 Total em fretes: R$ ${totalRoutes.toFixed(2)}\n`;
        response += `💸 Adiantamentos: R$ ${totalAdvances.toFixed(2)}\n`;
        response += `💵 *Saldo líquido: R$ ${balance.toFixed(2)}*`;

        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao consultar saldo.');
    }
});

bot.onText(/\/km (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const placa = match[1].toUpperCase();
    const km = parseInt(match[2]);

    try {
        const result = await db.run(
            'UPDATE vehicles SET kmAtual = ? WHERE UPPER(placa) = ?',
            km, placa
        );

        if (result.changes === 0) {
            return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
        }

        await bot.sendMessage(chatId, `✅ KM de ${placa} atualizado para ${km}km.`);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao atualizar KM.');
    }
});

// Armazena estados de conversação para OCR e Checklist
const userStates = new Map();

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Baixa a foto (maior resolução disponível)
        const photos = msg.photo;
        const photoId = photos[photos.length - 1].file_id;
        const fileLink = await bot.getFileLink(photoId);

        const tempPath = path.join(__dirname, `temp_${userId}_${Date.now()}.jpg`);

        // Download da imagem usando fetch
        const response = await fetch(fileLink);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(tempPath, Buffer.from(buffer));

        await bot.sendMessage(chatId, '📸 Processando imagem com OCR...');

        // Processa OCR
        const result = await Tesseract.recognize(tempPath, 'por', {
            logger: m => console.log(m)
        });

        const text = result.data.text;
        console.log('Texto OCR:', text);

        // Extrai dados do cupom
        const dados = extrairDadosCupom(text);

        // Remove arquivo temporário
        try { fs.unlinkSync(tempPath); } catch (e) {}

        if (dados.litros > 0 && dados.valorTotal > 0) {
            // Salva estado para confirmação
            userStates.set(userId, {
                type: 'ocr_fuel',
                dados: dados,
                step: 'placa'
            });

            await bot.sendMessage(chatId,
                `🔍 *Dados encontrados na imagem:*\n\n` +
                `⛽ Litros: ${dados.litros}L\n` +
                `💰 Valor: R$ ${dados.valorTotal.toFixed(2)}\n` +
                `📅 Data: ${dados.data || 'Hoje'}\n\n` +
                `Para confirmar, envie a *placa* do veículo.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId,
                `📸 Imagem recebida, mas não consegui ler os dados automaticamente.\n\n` +
                `Para registrar o abastecimento, envie:\n` +
                `/abastecer [placa] [litros] [valor_total] [km]\n\n` +
                `Exemplo: /abastecer QPZ5B67 50 300 15000`
            );
        }
    } catch (err) {
        console.error('Erro no OCR:', err);
        await bot.sendMessage(chatId,
            `❌ Erro ao processar imagem.\n\n` +
            `Para registrar o abastecimento, envie:\n` +
            `/abastecer [placa] [litros] [valor_total] [km]`
        );
    }
});

// Função para extrair dados do cupom fiscal (padrão brasileiro ANP/ESPM)
function extrairDadosCupom(texto) {
    const dados = {
        litros: 0,
        valorTotal: 0,
        valorLitro: 0,
        data: null,
        hora: null
    };

    // Remove quebras de linha extras e espaços
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const textoCompleto = linhas.join(' ').toUpperCase();

    console.log('Texto completo para análise:', textoCompleto.substring(0, 300));

    // 1. Busca a linha do produto (padrão: ETANOL 36,670LI 4,19 162,03)
    // O OCR pode ler "36,670LI" ou "36,670 LI"
    for (const linha of linhas) {
        const linhaUpper = linha.toUpperCase();
        // Padrão: número com vírgula + LI ou L + valor unitário + valor total
        const match = linhaUpper.match(/(\d+[,.]\d+)\s*L[I]?\s+(\d+[,.]\d+)\s+(\d+[,.]\d+)/);
        if (match) {
            dados.litros = parseFloat(match[1].replace(',', '.'));
            dados.valorLitro = parseFloat(match[2].replace(',', '.'));
            dados.valorTotal = parseFloat(match[3].replace(',', '.'));
            console.log('Produto encontrado:', match[1], match[2], match[3]);
            break;
        }
    }

    // 2. Se não achou, busca litros isolado (ex: "36,670LI")
    if (dados.litros === 0) {
        const matchL = textoCompleto.match(/(\d+[,.]\d+)\s*L[I]?/);
        if (matchL) {
            dados.litros = parseFloat(matchL[1].replace(',', '.'));
        }
    }

    // 3. Busca valor total em "VALOR À PAGAR R$ 162,03" ou variações
    if (dados.valorTotal === 0) {
        // Padrão: captura o último valor numérico após "PAGAR" ou "TOTAL"
        const matchPagar = textoCompleto.match(/(?:PAGAR|TOTAL)[^0-9]*?(\d+[,.]\d+)/i);
        if (matchPagar) {
            dados.valorTotal = parseFloat(matchPagar[1].replace(',', '.'));
        }
    }

    // 4. Fallback: busca o maior valor numérico no texto (geralmente é o total)
    if (dados.valorTotal === 0) {
        const todosNumeros = textoCompleto.match(/\d+[,.]\d+/g) || [];
        let maior = 0;
        for (const n of todosNumeros) {
            const val = parseFloat(n.replace(',', '.'));
            if (val > maior && val < 10000) maior = val;
        }
        dados.valorTotal = maior;
    }

    // 5. Calcula valor por litro se não foi encontrado
    if (dados.valorLitro === 0 && dados.litros > 0 && dados.valorTotal > 0) {
        dados.valorLitro = dados.valorTotal / dados.litros;
    }

    // 6. Busca data (padrão DD/MM/YYYY ou DD/MM/YY)
    // Procura no texto completo e em cada linha
    const padraoData = /(\d{2}[\/\\\-,]\d{2}[\/\\\-,]\d{2,4})/;
    for (const linha of linhas) {
        const match = linha.match(padraoData);
        if (match) {
            dados.data = match[1];
            break;
        }
    }

    // 7. Busca hora
    const padraoHora = /(\d{2}:\d{2}(:\d{2})?)/;
    for (const linha of linhas) {
        const match = linha.match(padraoHora);
        if (match) {
            dados.hora = match[1];
            break;
        }
    }

    console.log('Dados extraídos:', JSON.stringify(dados));

    return dados;
}

// Handler para mensagens de texto (gerencia estados)
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim().toLowerCase();

    const state = userStates.get(userId);
    if (!state) return;

    // OCR Fuel flow
    if (state.type === 'ocr_fuel') {
        console.log(`OCR Flow - User: ${userId}, Step: ${state.step}, Message: ${text}`);
        
        if (state.step === 'placa') {
            const placa = msg.text.trim().toUpperCase();
            const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa);

            if (!vehicle) {
                return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado. Envie uma placa válida.`);
            }

            state.placa = placa;
            state.vehicleId = vehicle.id;
            state.step = 'km';

            return bot.sendMessage(chatId,
                `✅ Veículo: ${placa}\n\n` +
                `Agora envie a *quilometragem* atual:`,
                { parse_mode: 'Markdown' }
            );
        }

        if (state.step === 'km') {
            const km = parseInt(msg.text.trim());
            if (isNaN(km)) {
                return bot.sendMessage(chatId, '❌ Envie um número válido para o KM.');
            }

            state.km = km;

            // Confirma dados
            const d = state.dados;
            await bot.sendMessage(chatId,
                `✅ *Confirme os dados:*\n\n` +
                `🚗 Placa: ${state.placa}\n` +
                `⛽ Litros: ${d.litros}L\n` +
                `💰 Valor: R$ ${d.valorTotal.toFixed(2)}\n` +
                `📍 KM: ${km}\n` +
                `📅 Data: ${new Date().toISOString().split('T')[0]}\n\n` +
                `Envie *sim* para confirmar ou *não* para cancelar.`,
                { parse_mode: 'Markdown' }
            );

            state.step = 'confirm';
            return; // CRITICAL: Prevents same message from being processed as confirmation
        }

        if (state.step === 'confirm') {
            console.log(`CONFIRM STEP - User: ${userId}, Received text: "${text}"`);
            
            if (text === 'sim' || text === 's') {
                const d = state.dados;
                const today = new Date().toISOString().split('T')[0];

                try {
                    await db.run(
                        `INSERT INTO fuel (id, veiculoId, data, litros, valorLitro, valorTotal, kmAbastecimento)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        crypto.randomBytes(12).toString('hex'),
                        state.vehicleId,
                        today,
                        d.litros,
                        (d.valorTotal / d.litros).toFixed(2),
                        d.valorTotal,
                        state.km
                    );

                    await db.run(
                        'UPDATE vehicles SET kmAtual = ?, kmUltimaManutencao = ? WHERE id = ?',
                        state.km, state.km, state.vehicleId
                    );

                    await bot.sendMessage(chatId,
                        `✅ *Abastecimento Registrado via OCR!*\n\n` +
                        `🚗 Placa: ${state.placa}\n` +
                        `⛽ ${d.litros}L × R$ ${(d.valorTotal / d.litros).toFixed(2)} = R$ ${d.valorTotal.toFixed(2)}\n` +
                        `📍 KM: ${state.km}\n` +
                        `📅 Data: ${today}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (err) {
                    console.error(err);
                    await bot.sendMessage(chatId, '❌ Erro ao salvar no banco de dados.');
                }
            } else {
                await bot.sendMessage(chatId, '❌ Registro cancelado.');
            }

            userStates.delete(userId);
        }
    }

    // Checklist flow
    if (state.type === 'checklist') {
        if (text !== 'sim' && text !== 's' && text !== 'não' && text !== 'nao' && text !== 'n') {
            return bot.sendMessage(chatId, '❌ Responda apenas: *sim* ou *não*', { parse_mode: 'Markdown' });
        }

        const resposta = (text === 'sim' || text === 's') ? 1 : 0;
        const perguntaAtual = perguntasChecklist[state.step];
        state.respostas[perguntaAtual.id] = resposta;

        state.step++;

        if (state.step < perguntasChecklist.length) {
            const proximaPergunta = perguntasChecklist[state.step];
            await bot.sendMessage(chatId,
                `Pergunta ${state.step + 1}/${perguntasChecklist.length}:\n*${proximaPergunta.texto}*\n\n` +
                `Responda: *sim* ou *não*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            // Salva checklist no banco
            const r = state.respostas;
            const today = new Date().toISOString().split('T')[0];

            try {
                await db.run(
                    `INSERT INTO checklists (id, veiculoId, data, pneus, oleo, agua, freios, farois, triangulo)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    crypto.randomBytes(12).toString('hex'),
                    state.vehicleId,
                    today,
                    r.pneus,
                    r.oleo,
                    r.agua,
                    r.freios,
                    r.farois,
                    r.triangulo
                );

                let aprovado = r.pneus && r.oleo && r.agua && r.freios && r.farois && r.triangulo;
                let emoji = aprovado ? '✅' : '⚠️';

                await bot.sendMessage(chatId,
                    `${emoji} *Checklist Concluído - ${state.placa}*\n\n` +
                    `📍 Pneus: ${r.pneus ? 'OK' : 'NOK'}\n` +
                    `🛢️ Óleo: ${r.oleo ? 'OK' : 'NOK'}\n` +
                    `💧 Água: ${r.agua ? 'OK' : 'NOK'}\n` +
                    `🛑 Freios: ${r.freios ? 'OK' : 'NOK'}\n` +
                    `💡 Faróis: ${r.farois ? 'OK' : 'NOK'}\n` +
                    `🔺 Triângulo: ${r.triangulo ? 'OK' : 'NOK'}\n\n` +
                    `Data: ${today}`,
                    { parse_mode: 'Markdown' }
                );

                if (!aprovado) {
                    await bot.sendMessage(chatId,
                        `⚠️ *Atenção!* Veículo com itens reprovados. Verificar antes de seguir viagem.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (err) {
                console.error(err);
                await bot.sendMessage(chatId, '❌ Erro ao salvar checklist.');
            }

            userStates.delete(userId);
        }
    }
});

bot.onText(/\/abastecer (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const placa = match[1].toUpperCase();
    const liters = parseFloat(match[2]);
    const totalValue = parseFloat(match[3]);
    const odometer = parseInt(match[4]);

    try {
        const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa);
        if (!vehicle) {
            return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
        }

        const pricePerLiter = (totalValue / liters).toFixed(2);
        const today = new Date().toISOString().split('T')[0];

        await db.run(
            `INSERT INTO fuel (id, veiculoId, data, litros, valorLitro, valorTotal, kmAbastecimento)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            crypto.randomBytes(12).toString('hex'),
            vehicle.id,
            today,
            liters,
            pricePerLiter,
            totalValue,
            odometer
        );

        await db.run(
            'UPDATE vehicles SET kmAtual = ?, kmUltimaManutencao = ? WHERE id = ?',
            odometer, odometer, vehicle.id
        );

        await bot.sendMessage(chatId,
            `✅ *Abastecimento Registrado*\n\n` +
            `🚗 Placa: ${placa}\n` +
            `⛽ ${liters}L × R$ ${pricePerLiter} = R$ ${totalValue}\n` +
            `📍 KM: ${odometer}\n` +
            `📅 Data: ${today}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao registrar abastecimento.');
    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `📖 *Ajuda - Transpbussines Bot*\n\n` +
        `Exemplos de uso:\n` +
        `• /combustivel QPZ5B67\n` +
        `• /rota QPZ5B67\n` +
        `• /saldo João\n` +
        `• /km QPZ5B67 15000\n` +
        `• /abastecer QPZ5B67 50 300 15000\n\n` +
        `Envie fotos de cupons para registro rápido.`,
        { parse_mode: 'Markdown' }
    );
});

initDB().then(() => {
    console.log('🤖 Bot do Telegram iniciado!');
    console.log('✅ Conectado ao banco de dados');
    console.log('📱 Acesse: https://t.me/transpbussines_bot');
}).catch(err => {
    console.error('❌ Erro ao iniciar:', err);
});

// Checklist interativo
const perguntasChecklist = [
    { id: 'pneus', texto: 'Pneus em bom estado?' },
    { id: 'oleo', texto: 'Nível de óleo OK?' },
    { id: 'agua', texto: 'Água do radiador OK?' },
    { id: 'freios', texto: 'Freios funcionando?' },
    { id: 'farois', texto: 'Faróis/lanternas OK?' },
    { id: 'triangulo', texto: 'Triângulo/chuveiro presentes?' }
];

bot.onText(/\/checklist (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const placa = match[1].toUpperCase();

    const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa);
    if (!vehicle) {
        return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
    }

    userStates.set(userId, {
        type: 'checklist',
        placa: placa,
        vehicleId: vehicle.id,
        step: 0,
        respostas: {}
    });

    const pergunta = perguntasChecklist[0];
    await bot.sendMessage(chatId,
        `🔧 *Checklist - ${placa}*\n\n` +
        `Pergunta 1/${perguntasChecklist.length}:\n*${pergunta.texto}*\n\n` +
        `Responda: *sim* ou *não*`,
        { parse_mode: 'Markdown' }
    );
});

// Comando para gerenciar alertas
bot.onText(/\/alertas (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const option = match[1].toLowerCase();

    if (option === 'on' || option === 'sim') {
        if (!adminChats.includes(chatId.toString())) {
            adminChats.push(chatId.toString());
            saveAdmins(adminChats);
            bot.sendMessage(chatId, '✅ Você receberá alertas de manutenção e contas a pagar.');
        } else {
            bot.sendMessage(chatId, 'ℹ️ Você já está inscrito para receber alertas.');
        }
    } else if (option === 'off' || option === 'não' || option === 'nao') {
        adminChats = adminChats.filter(id => id !== chatId.toString());
        saveAdmins(adminChats);
        bot.sendMessage(chatId, '❌ Você não receberá mais alertas.');
    } else {
        bot.sendMessage(chatId,
            `📢 *Gerenciar Alertas*\n\n` +
            `Use: /alertas on - Para receber alertas\n` +
            `Use: /alertas off - Para parar de receber\n\n` +
            `Alertas enviados: ${adminChats.length} chat(s)`,
            { parse_mode: 'Markdown' }
        );
    }
});

// Função para verificar e enviar alertas de manutenção
async function checkManutencao() {
    try {
        const vehicles = await db.all('SELECT * FROM vehicles WHERE ativo = 1');
        const alertas = [];

        for (const v of vehicles) {
            const km = v.kmAtual || 0;
            const proxOleo = v.kmProximoOleo || (v.kmTrocaOleo + 10000);
            const proxPneus = v.kmProximoPneus || (v.kmTrocaPneus + 40000);
            const proxManut = v.kmProximaManutencao || (v.kmUltimaManutencao + 10000);

            if (km >= proxOleo - 500) {
                alertas.push(`🛢️ ${v.placa} - Troca de óleo próxima (${km}/${proxOleo}km)`);
            }
            if (km >= proxPneus - 2000) {
                alertas.push(`🛞 ${v.placa} - Troca de pneus próxima (${km}/${proxPneus}km)`);
            }
            if (km >= proxManut - 1000) {
                alertas.push(`🔧 ${v.placa} - Manutenção próxima (${km}/${proxManut}km)`);
            }
        }

        return alertas;
    } catch (err) {
        console.error('Erro ao verificar manutenção:', err);
        return [];
    }
}

// Função para verificar contas vencendo
async function checkContas() {
    try {
        const hoje = new Date().toISOString().split('T')[0];
        const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const vencendo = await db.all(
            `SELECT * FROM payables WHERE status != 'Pago' AND vencimento <= ?`,
            amanha
        );

        const alertas = [];
        for (const c of vencendo) {
            const dias = Math.ceil((new Date(c.vencimento) - new Date(hoje)) / 86400000);
            const prefixo = dias <= 0 ? '🚨' : '⚠️';
            alertas.push(`${prefixo} ${c.descricao} - R$ ${c.valor} (${dias <= 0 ? 'VENCE HOJE' : 'VENCE AMANHÃ'})`);
        }

        return alertas;
    } catch (err) {
        console.error('Erro ao verificar contas:', err);
        return [];
    }
}

// Enviar alertas para todos os admins
async function enviarAlertas() {
    if (adminChats.length === 0) return;

    const alertasManut = await checkManutencao();
    const alertasContas = await checkContas();

    if (alertasManut.length === 0 && alertasContas.length === 0) return;

    let mensagem = `🔔 *Alertas Automáticos*\n\n`;

    if (alertasManut.length > 0) {
        mensagem += `*Manutenção:*\n`;
        alertasManut.forEach(a => mensagem += `${a}\n`);
        mensagem += `\n`;
    }

    if (alertasContas.length > 0) {
        mensagem += `*Contas a Pagar:*\n`;
        alertasContas.forEach(a => mensagem += `${a}\n`);
    }

    for (const chatId of adminChats) {
        try {
            await bot.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`Erro ao enviar alerta para ${chatId}:`, err.message);
        }
    }
}

// Verificar alertas a cada 24 horas
setInterval(enviarAlertas, 24 * 60 * 60 * 1000);

// Função para gerar PDF de abastecimentos
async function gerarPDFCombustivel(placa) {
    const vehicle = await db.get('SELECT * FROM vehicles WHERE UPPER(placa) = ?', placa.toUpperCase());
    if (!vehicle) return null;

    const records = await db.all(
        `SELECT * FROM fuel WHERE veiculoId = ? ORDER BY data DESC LIMIT 50`,
        vehicle.id
    );

    const pdfPath = path.join(__dirname, `relatorio_${placa}_${Date.now()}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Cabeçalho
    doc.fontSize(20).text('Relatório de Abastecimentos', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Veículo: ${vehicle.placa} - ${vehicle.modelo || ''}`);
    doc.fontSize(10).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    doc.moveDown();

    // Tabela
    let totalL = 0, totalV = 0;
    records.forEach((r, i) => {
        doc.fontSize(10).text(
            `${r.data} | ${r.litros}L | R$ ${r.valorLitro} | R$ ${r.valorTotal} | KM: ${r.kmAbastecimento || 'N/A'}`
        );
        totalL += r.litros || 0;
        totalV += r.valorTotal || 0;
    });

    doc.moveDown();
    doc.fontSize(12).text(`Total: ${totalL.toFixed(1)}L | R$ ${totalV.toFixed(2)}`);

    doc.end();
    return new Promise(resolve => stream.on('finish', () => resolve(pdfPath)));
}

// Função para gerar PDF de rotas
async function gerarPDFRotas(mes, ano) {
    const records = await db.all(
        `SELECT r.*, v.placa, d.nome as motorista 
         FROM routes r 
         LEFT JOIN vehicles v ON v.id = r.veiculoId
         LEFT JOIN drivers d ON d.id = r.motoristaId
         WHERE strftime('%m', r.data) = ? AND strftime('%Y', r.data) = ?
         ORDER BY r.data`,
        mes.toString().padStart(2, '0'), ano.toString()
    );

    const pdfPath = path.join(__dirname, `rotas_${mes}_${ano}_${Date.now()}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(20).text('Relatório de Rotas', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Período: ${mes}/${ano}`);
    doc.fontSize(10).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    doc.moveDown();

    let totalKm = 0, totalV = 0;
    records.forEach(r => {
        doc.fontSize(10).text(
            `${r.data} | ${r.placa} | ${r.origem} → ${r.destino} | ${r.km || 0}km | R$ ${r.valorFrete || 0}`
        );
        totalKm += r.km || 0;
        totalV += r.valorFrete || 0;
    });

    doc.moveDown();
    doc.fontSize(12).text(`Total KM: ${totalKm} | Receita: R$ ${totalV.toFixed(2)}`);

    doc.end();
    return new Promise(resolve => stream.on('finish', () => resolve(pdfPath)));
}

// Comando para enviar relatório de combustível
bot.onText(/\/relatorio_combustivel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const placa = match[1].toUpperCase();

    await bot.sendMessage(chatId, '📄 Gerando relatório de abastecimentos...');

    const pdfPath = await gerarPDFCombustivel(placa);
    if (!pdfPath) {
        return bot.sendMessage(chatId, `❌ Veículo ${placa} não encontrado.`);
    }

    try {
        await bot.sendDocument(chatId, pdfPath);
        fs.unlinkSync(pdfPath);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao enviar relatório.');
    }
});

// Comando para enviar relatório de rotas
bot.onText(/\/relatorio_rotas (\d{1,2}) (\d{4})/, async (msg, match) => {
    const chatId = msg.chat.id;
    const mes = parseInt(match[1]);
    const ano = parseInt(match[2]);

    await bot.sendMessage(chatId, '📄 Gerando relatório de rotas...');

    const pdfPath = await gerarPDFRotas(mes, ano);
    if (!pdfPath) {
        return bot.sendMessage(chatId, '❌ Erro ao gerar relatório.');
    }

    try {
        await bot.sendDocument(chatId, pdfPath);
        fs.unlinkSync(pdfPath);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Erro ao enviar relatório.');
    }
});

// Atualizar help para incluir novos comandos
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `📖 *Ajuda - Transpbussines Bot*\n\n` +
        `📊 *Consultas:*\n` +
        `• /combustivel QPZ5B67\n` +
        `• /rota QPZ5B67\n` +
        `• /saldo João\n` +
        `• /km QPZ5B67 15000\n\n` +
        `📝 *Registros:*\n` +
        `• /abastecer QPZ5B67 50 300 15000\n` +
        `• /checklist QPZ5B67\n\n` +
        `📄 *Relatórios PDF:*\n` +
        `• /relatorio_combustivel QPZ5B67\n` +
        `• /relatorio_rotas 05 2026\n\n` +
        `📢 *Alertas:*\n` +
        `• /alertas on - Ativar alertas\n` +
        `• /alertas off - Desativar\n\n` +
        `Envie fotos de cupons para OCR automático.`,
        { parse_mode: 'Markdown' }
    );
});

// Verificar na inicialização
initDB().then(() => {
    console.log('🤖 Bot do Telegram iniciado!');
    console.log('✅ Conectado ao banco de dados');
    console.log('📱 Acesse: https://t.me/transpbussines_bot');
    console.log(`📢 Alertas configurados para ${adminChats.length} chat(s)`);

    // Envia alertas na inicialização
    setTimeout(enviarAlertas, 5000);
}).catch(err => {
    console.error('❌ Erro ao iniciar:', err);
});
