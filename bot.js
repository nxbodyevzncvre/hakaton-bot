const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const botResponse = require("./index.js");
const fs = require('fs');
const axios = require('axios');
const Tesseract = require('tesseract.js'); // Ensure Tesseract.js is installed
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let userStates = {};
let users = new Set();

// Загрузка логов в файл user_logs.txt
function logMessageToFile(username, userMessage, botResponse) {
    const logMessage = `Имя: ${username}, Сообщение: ${userMessage}, Ответ бота: ${botResponse}\n`;
    fs.appendFileSync('./logs/users_logs.txt', logMessage, 'utf8');
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
    const userId = ctx.chat.id;
    users.add(userId);
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

// /admin
bot.command('admin', (ctx) => {
    const userId = ctx.chat.id;
    userStates[userId] = 'awaiting_admin_code';
    ctx.reply('Введите секретный код для доступа к админ-панели:');
});

// Основные проверки на введеный текст пользователем
bot.on('text', async (ctx) => {
    const userId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // Получение админ токена
    if (userStates[userId] === 'awaiting_admin_code') {
        if (userMessage === ADMIN_PASSWORD) {
            userStates[userId] = 'admin';
            return showAdminPanel(ctx);
        } else {
            return ctx.reply('Неверный код. Попробуйте снова.');
        }
    }
     if (userStates[userId] === 'awaiting_client_code') {
                userStates[userId].clientCode = userMessage; // Сохраняем код клиента
                userStates[userId] = 'checking_address'; // Переводим в режим ожидания фото
                return ctx.reply(`Код клиента "${userMessage}" сохранен. Теперь отправьте фотографию для проверки адреса.`);
            }

    // Проверка на админа и начало рассылки
    if (userStates[userId] === 'sending_news') {
        const newsMessage = userMessage;
        userStates[userId] = 'admin';
        await ctx.reply('Рассылка начата. Ожидайте завершения.');

        await handleNewsBroadcast(ctx, newsMessage);
        return showAdminPanel(ctx); 
    }

    // Обработка всех видов сообщений боту
    switch (userMessage) {
        case 'Связь с менеджером':
            return ctx.reply('Связь с менеджером: https://wa.me/1234567890');
        case 'Подписаться':
            return ctx.reply('Вы успешно подписались на обновления!');
        case 'Отписаться':
            return ctx.reply('Вы успешно отписались от обновлений!');
        case 'Задать вопрос':
            userStates[userId] = 'asking_question';
            return ctx.reply('Задайте ваш вопрос. Для выхода выберите другое действие.');
        case 'Проверить правильность адреса':
            userStates[userId] = 'awaiting_client_code'; // Ожидаем код клиента
            ctx.reply('Отправьте индивидуальный код клиента для проверки адреса.');
            break;

        default:
            if (userStates[userId] === 'asking_question') {
                try {
                    const response = await botResponse(userMessage);                
                    logMessageToFile(ctx.message.chat.first_name, userMessage, response);
                    return ctx.reply(response, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Вернуться в главное меню', callback_data: 'main_menu' }], 
                                [{ text: 'Связаться с менеджером', url: 'https://wa.me/1234567890' }]
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

// Обработка фото
bot.on('photo', async (ctx) => {
    const userId = ctx.chat.id;

    // Проверка, что код клиента был введен
    if (userStates[userId] === 'checking_address' && userStates[userId].clientCode) {
        try {
            await ctx.reply('Обрабатываю изображение...');
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileId = photo.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);

            // Скачивание фото
            const filePath = `temp_image_${Date.now()}.jpg`;
            const response = await axios.get(fileLink.href, { responseType: 'stream' });
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Применение OCR с Tesseract.js
            const { data: { text } } = await Tesseract.recognize(filePath, 'chi_tra'); // Используйте 'chi_tra' для китайского или другие языки
            fs.unlinkSync(filePath); // Удаление временного файла

            await ctx.reply(`Извлечённый текст:\n"${text.trim()}"`);

            // Валидация адреса
            if (validateAddress(userStates[userId].clientCode, text)) {
                return ctx.reply('Адрес указан корректно!');
            } else {
                return ctx.reply('Похоже, что адрес указан неверно.');
            }
        } catch (error) {
            console.error(error);
            return ctx.reply('Произошла ошибка при обработке изображения.');
        }
    } else {
        return ctx.reply('Пожалуйста, сначала отправьте код клиента для проверки адреса.');
    }
});

// По названию надеюсь понятно...
function showAdminPanel(ctx) {
    ctx.reply('Добро пожаловать в админ-панель! Выберите действие:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📢 Рассылка новостей', callback_data: 'send_news' }],
                [{ text: '👥 Список пользователей', callback_data: 'list_users' }],
                [{ text: '✉ Получить логи', callback_data: 'logs' }],
                [{ text: '🔙 Выйти из панели', callback_data: 'exit_admin' }],
            ],
        },
    });
}

function validateAddress(clientCode, extractedText) {
    // Логика валидации адреса с использованием clientCode и извлеченного текста
    if (extractedText.includes(clientCode)) {
        return true;
    } else {
        return false;
    }
}

// Обработка всех штук снизу сообщения
bot.on('callback_query', async (ctx) => {
    const userId = ctx.chat.id;
    const option = ctx.callbackQuery.data;

    if (userStates[userId] !== 'admin') {
        return ctx.reply('У вас нет доступа к этой функции.');
    }

    switch (option) {
        case 'send_news':
            userStates[userId] = 'sending_news';
            return ctx.reply('Введите текст новости для рассылки:');
        case 'logs':
            return sendLogsToAdmin(ctx);
        case 'list_users':
            return ctx.reply(`Всего пользователей: ${users.size}`);
        case 'exit_admin':
            userStates[userId] = null;
            return ctx.reply('Вы вышли из админ-панели.');
        default:
            return ctx.reply('Неизвестная команда.');
    }
});

// Функция для отправки рассылки каждому подписанному пользователю
async function handleNewsBroadcast(ctx, message) {
    let successCount = 0;
    let failCount = 0;

    for (const userId of users) {
        try {
            await ctx.telegram.sendMessage(userId, `📢 Новости:\n${message}`);
            successCount++;
        } catch (error) {
            console.error(`Ошибка отправки для пользователя ${userId}:`, error);
            failCount++;
        }
    }

    ctx.reply(`Рассылка завершена. Успешно отправлено: ${successCount}, Ошибок: ${failCount}`);
}

// Успешный запуск бота
bot.launch().then(() => {
    console.log('Бот запущен!');
});
