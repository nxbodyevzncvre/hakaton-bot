const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const botResponse = require("./index.js");
const fs = require('fs');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const path = require('path')
const bcrypt = require('bcrypt');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const bot = new Telegraf(process.env.BOT_TOKEN);

// Проверка пароля
async function checkPassword(inputPassword, storedHash) {
    return await bcrypt.compare(inputPassword, storedHash);
}

// Пример использования
async function verifyAdminPassword(inputPassword) {
    const storedHash = process.env.ADMIN_PASSWORD_HASH;  // Хеш пароля из переменных окружения
    const isPasswordValid = await checkPassword(inputPassword, storedHash);  // Проверка пароля с использованием bcrypt
    return isPasswordValid;  // Возвращаем результат
}

const fileManager = new GoogleAIFileManager(process.env.API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
  });

let userStates = {};
let users = new Set();
let users_Broadcast = new Set()

// Загрузка логов в файл user_logs.txt
async function logMessageToFile(username, userMessage, botResponse) {
    const logMessage = `Имя: ${username}, Сообщение: ${userMessage}, Ответ бота: ${botResponse}\n`;
    try {
        await fs.promises.appendFile('./logs/users_logs.txt', logMessage, 'utf8');
    } catch (error) {
        console.error('Ошибка при записи логов:', error);
    }
}

// Функция для отправки логов администратору
async function sendLogsToAdmin(ctx) {
    const filePath = './logs/users_logs.txt';
    try {
        await ctx.replyWithDocument({ source: filePath });
        fs.unlinkSync(filePath); // Удаляем файл после отправки
    } catch (error) {
        console.error('Ошибка при отправке логов:', error);
        ctx.reply('Произошла ошибка при отправке логов.');
    }
}

// Начало бота
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.message.chat.username
    users[username] = chatId;
    
    ctx.reply('Привет! Я бот, который может помочь тебе с вопросами, связанные с SilkWay Cargo. Также, я проверяю на правильность заполненную адресную строку в таких приложениях, как: Pinduoduo, 1688, Alibaba, Taobao', {
        reply_markup: {
            keyboard: [
                [
                    { text: 'Задать вопрос' },
                    { text: 'Проверить правильность адреса' },
                ],
                [{ text: 'Связь с менеджером' }],
                [{ text: 'Подписаться' }, { text: 'Отписаться' }]
            ],
            resize_keyboard: true,
        }
    });
});

bot.hears('Подписаться', (ctx) => {
    const username = ctx.message.chat.username;
    const chatId = ctx.chat.id;

    if (!users_Broadcast[username]) {  // Если пользователя нет в объекте
        users_Broadcast[username] = chatId; // Подписываем пользователя
        ctx.reply('Вы успешно подписались на рассылку!');
    } else {
        ctx.reply('Вы уже подписаны.');
    }
});

bot.hears('Отписаться', (ctx) => {
    const username = ctx.message.chat.username;

    if (users_Broadcast[username]) {  // Если пользователь есть в объекте
        delete users_Broadcast[username]; // Отписываем пользователя
        ctx.reply('Вы успешно отписались от рассылки!');
    } else {
        ctx.reply('Вы не были подписаны.');
    }
});


// /admin
bot.command('admin', (ctx) => {
    const userId = ctx.chat.id;
    userStates[userId] = { state: 'awaiting_admin_code' };
    ctx.reply('Введите секретный код для доступа к админ-панели:');
});

// Обработка всех текстовых сообщений
bot.on('text', async (ctx) => {
    const userId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // Инициализируем состояние пользователя, если его нет
    if (!userStates[userId]) {
        userStates[userId] = { state: null };
    }

    // Получение админ токена
    if (userStates[userId].state === 'awaiting_admin_code') {
        const isPasswordValid = await verifyAdminPassword(userMessage);  // Ожидаем результат асинхронной проверки пароля
        if (isPasswordValid) {
            userStates[userId] = { state: 'admin' };
            return showAdminPanel(ctx);
        } else {
            return ctx.reply('Неверный код. Попробуйте снова.');
        }
    }

    if (userStates[userId].state === 'awaiting_client_code') {
        userStates[userId].clientCode = userMessage; // Сохраняем код клиента
        userStates[userId].state = 'awaiting_photo'; // Переводим в состояние ожидания фотографии

        return ctx.reply(`Код клиента "${userMessage}" сохранен. Теперь отправьте фотографию для проверки адреса.`);
    }

    // Проверка на админа и начало рассылки
    if (userStates[userId].state === 'sending_news') {
        const newsMessage = userMessage;
        userStates[userId] = { state: 'admin' };
        await ctx.reply('Рассылка начата. Ожидайте завершения.');
        await handleNewsBroadcast(ctx, newsMessage);
        return showAdminPanel(ctx);
    }

    // Обработка всех видов сообщений боту
    switch (userMessage) {
        case 'Связь с менеджером':
            return ctx.reply('Связь с менеджером: https://api.whatsapp.com/send?phone=77055188988&text=');
        case 'Подписаться':
            return ctx.reply('Вы успешно подписались на обновления!');
        case 'Отписаться':
            return ctx.reply('Вы успешно отписались от обновлений!');
        case 'Задать вопрос':
            userStates[userId] = { state: 'asking_question' };
            return ctx.reply('Задайте ваш вопрос. Для выхода выберите другое действие.');
        case 'Проверить правильность адреса':
            userStates[userId] = { state: 'awaiting_client_code' }; // Ожидаем код клиента
            ctx.reply('Отправьте индивидуальный код клиента для проверки адреса.');
            break;
        default:
            if (userStates[userId].state === 'asking_question') {
                try {
                    const response = await botResponse(userMessage);                
                    logMessageToFile(ctx.message.chat.username, userMessage, response);
                    return ctx.reply(response, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Вернуться в главное меню', callback_data: 'main_menu' }],
                                [{ text: 'Связаться с менеджером', url: 'https://api.whatsapp.com/send?phone=77055188988&text=' }]
                            ],
                        },
                    });
                } catch (error) {
                    console.error('Ошибка в botResponse:', error);
                    return ctx.reply('Произошла ошибка при обработке вашего вопроса.');
                }
            }
            return ctx.reply('Вы выбрали несуществующую функцию.');
    }
});



bot.on('photo', async (ctx) => {
    const userId = ctx.chat.id;
    // Ожидаем фото
    if (userStates[userId]?.state === 'awaiting_photo') {
        try {
            await ctx.reply('Обрабатываю изображение...');

            // Получаем ссылку на изображение
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileId = photo.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            if (!fileLink) {
                return ctx.reply('Не удалось получить ссылку на изображение.');
            }

            // Скачивание изображения
            const filePath = `adresses/temp_image_${Date.now()}.png`;
            const response = await axios.get(fileLink.href, { responseType: 'stream' });
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log('Изображение успешно сохранено');
            const name = path.parse(filePath).name;
            // запрос ии
            const query = `
                Ты бот компании SilkWay. Пользователь тебе дает скриншот, сравни текст, 
                написанный пользователем на китайском языке, с тем текстом, который у тебя есть.
                Если данные введены правильно, напиши: "Все заполнено правильно".
                ВНИМАТЕЛЬНО ПРОСМОТРИ ВСЕ ИЕРОГЛИФЫ
                Если иероглифы одинаковы, скажи, что все заполнено верно и все ничего больше
                Не обращай внимания на пробелы
                Заверши разговор в любом случае.
                Только не затягивай максимум 1 предложение в строгом формальном стиле
                Не обращай внимания на запятые
                Правильный адресс тот, который у тебя есть, а точнее, с которым ты сравниваешь

                Данные для проверки:
                努尔波${userStates[userId].clientCode} 13078833342广东省佛山市南海区里水镇新联工业区工业大道东一路3号航达B01库区 ${userStates[userId].clientCode}号

            `;
            // фотку ии отправляем
            const uploadResult = await fileManager.uploadFile(
                `${filePath}`,
                {
                  mimeType: "image/png",
                  displayName: name,
                },
              );

              const result = await model.generateContent([
                `${query}`,
                {
                  fileData: {
                    fileUri: uploadResult.file.uri,
                    mimeType: uploadResult.file.mimeType,
                  },
                },
              ]); 

            // Обработка результата
            if (result && result.response && result.response.candidates) {
                const candidates = result.response.candidates;
                const firstCandidateText = candidates[0].content.parts;
                let arr = []

                candidates[0].content.parts.forEach((el) => {
                    arr.push(el.text)
                }) 
                console.log(arr[0])
                

                console.log(`Результат обработки: ${firstCandidateText}`);
                await ctx.reply(`${arr[0]}`);
            } else {
                console.log('Ответ модели отсутствует или некорректен.');
                await ctx.reply('Не удалось обработать изображение. Попробуйте еще раз.');
            }

        } catch (error) {
            console.error(`Ошибка: ${error.message}`);
            await ctx.reply('Произошла ошибка при обработке изображения.');
        }
    } else {
        await ctx.reply('Пожалуйста, сначала отправьте код клиента для проверки адреса.');
    }
});


// По названию надеюсь понятно...
function showAdminPanel(ctx) {
    ctx.reply('Добро пожаловать в админ-панель! Выберите действие:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📢 Рассылка новостей', callback_data: 'send_news' }],
                [{ text: '👥 Список пользователей', callback_data: 'list_users' }],
                [{ text: '👥 📢 Список пользователей c рассылкой', callback_data: 'list_broadcast_users' }],
                [{ text: '✉ Получить логи', callback_data: 'logs' }],
                [{ text: '🔙 Выйти из панели', callback_data: 'exit_admin' }],
            ],
        },
    });
}

// Обработка всех штук снизу сообщения
bot.on('callback_query', async (ctx) => {
    const userId = ctx.chat.id;
    const option = ctx.callbackQuery.data;


    switch (option) {
        case 'send_news':
            userStates[userId] = { state: 'sending_news' };
            return ctx.reply('Введите текст новости для рассылки:');
        case 'logs':
            return sendLogsToAdmin(ctx);
        case 'list_users':
            let users_default = [];
            for (const username in users) {
                users_default.push(username); // Добавляем только username
            }
            return ctx.reply(`Всего пользователей:\n${users_default.join('\n')}`);
        case 'list_broadcast_users':
            let users_with_broadcast = [];
            for (const username in users_Broadcast) {
                users_with_broadcast.push(username); // Добавляем только username
            }
            // Отправляем сообщение с перечислением пользователей
            return ctx.reply(`Всего пользователей с подпиской:\n${users_with_broadcast.join('\n')}`);
    
        case 'exit_admin':
            userStates[userId] = { state: null };
            return ctx.reply('Вы вышли из админ-панели.');
        case 'main_menu': 
            return ctx.reply('Вы вернулись в главное меню.');
        default:
            return ctx.reply('Неизвестная команда.');
    }
});

// Функция для отправки рассылки каждому подписанному пользователю
async function handleNewsBroadcast(ctx, message) {
    let successCount = 0;
    let failCount = 0;

    // Итерируем по ключам объекта users_Broadcast, где ключ — это username, а значение — chatId
    for (const username in users_Broadcast) {
        const chatId = users_Broadcast[username];
        try {
            await ctx.telegram.sendMessage(chatId, `📢 Новости:\n${message}`);
            successCount++;
        } catch (error) {
            console.error(`Ошибка отправки для пользователя ${chatId}:`, error);
            failCount++;
        }
    }

    // Ответ после рассылки
    ctx.reply(`Рассылка завершена. Успешно отправлено: ${successCount}, Ошибок: ${failCount}`);
}


// Успешный запуск бота
bot.launch().then(() => {
    console.log('Бот запущен!');
});
