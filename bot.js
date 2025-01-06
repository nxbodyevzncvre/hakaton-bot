const { Telegraf } = require('telegraf');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const fs = require('fs');
const dotenv = require('dotenv')
dotenv.config()

const bot = new Telegraf(process.env.API_KEY);

bot.start((ctx) => {
    ctx.reply('Привет! Я бот, который может помочь тебе с вопросами, связанные с SilkWay Cargo. Также, я проверяю на правильность заполненную адресную строку в таких приложениях, как: Pinduoduo, 1688, Alibaba, Taobao');
}); 
  
  
bot.on('photo', async (ctx) => {
try {
    ctx.reply('Обрабатываю изображение...');

    const photo = ctx.message.photo[ctx.message.photo.length - 1]; 
    const fileId = photo.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const filePath = `temp_image_${Date.now()}.jpg`;
    const response = await axios.get(fileLink.href, { responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    const { data: { text } } = await Tesseract.recognize(filePath, 'chi_tra');
    ctx.reply(`Извлечённый текст:\n"${text.trim()}"`);

    if (validateAddress(text)) {
        ctx.reply('Адрес указан корректно!');
    } else {
        ctx.reply('Похоже, что адрес указан неверно.');
    }

    fs.unlinkSync(filePath);
    } catch (error) {
        console.error(error);
        ctx.reply('Произошла ошибка при обработке изображения.');
    }
});
  
bot.launch().then(() => {
    console.log('Бот запущен!');
});