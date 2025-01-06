import dotenv from "dotenv"
dotenv.config()
const { google } = require('googleapis');
const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);
const documentId = process.evnv.DOCUMENT_ID
const CREDENTIALS_PATH = './credentials.json';
const credentials = require(CREDENTIALS_PATH);
import { GoogleGenerativeAI } from "@google/generative-ai";
const apiKey = process.env.API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

async function getQAFromDocument() {
  return await extractQAFromDocument(documentId);
}

let qAndAData = [];

getQAFromDocument().then(data => {
  qAndAData = data;
  console.log('QA data loaded');
});

bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text.trim().toLowerCase(); 
  const qa = qAndAData.find(item => item.question.toLowerCase() === userMessage);

  if (qa) {
    ctx.reply(qa.answer); 
  } else {
    ctx.reply('К сожалению, ответа на этот вопрос нет.'); 
  }
});

bot.launch();

const docs = google.docs('v1');

async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
  });

  const authClient = await auth.getClient();
  return authClient;
}

async function getDocumentContent(documentId) {
  const authClient = await authenticate();
  
  const res = await docs.documents.get({
    auth: authClient,
    documentId,
  });
  
  return res.data.body.content; 
}

async function extractQAFromDocument(documentId) {
    const content = await getDocumentContent(documentId);
    const qAndA = [];
  
    content.forEach(element => {
      if (element.paragraph) {
        const text = element.paragraph.elements.map(e => e.textRun ? e.textRun.content : '').join('');
        if (text) {
      
          const match = text.trim().match(/^([^\:]+)\:(.*)$/);
          if (match && match.length === 3) {
            const question = match[1].trim().toLowerCase();  
            const answer = match[2].trim();  
            qAndA.push({ question, answer });
          }
        }
      }
    });
  return qAndA;
}

async function getResponse(userInput, rules) {
  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            text: `Ты бот для отслеживания грузов. Пользователь спрашивает: "${userInput}". Сгенерируй ответ, следуя следующим инструкциям:
            1. Ответ должен быть понятным и информативным.
            2. Если информация о грузе недоступна, сообщи об этом.
            3. Придерживайся формального стиля общения.
            4. Используй точные данные, когда это возможно, иначе укажи, что нужно уточнить.
            
            ${rules}
            
            
            `
          },
        ],
      },
    ],
  });
  try {
    const result = await chatSession.sendMessage(userIn);
    console.log("Send message result:", result); // Логируем результат

    // Проверяем, что текст — это функция, и вызываем её
    if (typeof result.response.text === 'function') {
      return result.response.text(); // Вызываем функцию для получения текста
    } else {
      return result.response.text; // Если это уже текст, возвращаем его напрямую
    }
  } catch (error) {
    console.error("Error:", error); // Логируем ошибку, если она есть
    return "Ошибка при получении ответа";
  }
}
getResponse("салам брод")
  .then(response => {
    if (response) {
      console.log(response); // Если есть текст ответа, выводим его
    } else {
      console.log("Не удалось получить ответ от бота");
    }
  })
  .catch(error => {
    console.error("Error in promise chain:", error);
  });

console.log('Введите вопрос для бота, или напишите "exit" для выхода.');
