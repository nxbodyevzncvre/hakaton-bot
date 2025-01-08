const dotenv = require("dotenv");
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const credentials = require('./credentials.json');
const path = require('path');
const fs = require("fs");
dotenv.config();


const documentId = process.env.DOCUMENT_ID;
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const docs = google.docs('v1');
const fileManager = new GoogleAIFileManager(process.env.API_KEY);


// Список всех записей из google docs document
let qAndAData = [];

// Подключаемся к модели
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

// Конфиг для подлючения модели
const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// Объект для хранения истории сообщений пользователей
let userHistory = {};

// Асинхронное получение записей из документа по айди документа
async function getQAFromDocument() {
  return await extractQAFromDocument(documentId);
}

// А тут мы уже загружаем в наш массив
async function loadQAData() {
  const data = await getQAFromDocument();
  qAndAData = data;
  console.log('QA Data loaded:');
}

loadQAData(); // Загружаем данные в самом начале бота

// А это аутентификация для подключения google docs api
async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
  });

  const authClient = await auth.getClient();
  return authClient;
}

// Ну первоночальное получение записей
async function getDocumentContent(documentId) {
  const authClient = await authenticate();
  
  const res = await docs.documents.get({
    auth: authClient,
    documentId,
  });
  
  return res.data.body.content; 
}

// Тут он нам выдает данные в виде {question, answer} для дальнейшей работы с Gemini
async function extractQAFromDocument(documentId) {
  const content = await getDocumentContent(documentId);
  const qAndA = [];
  
  // Перебираем все записи циклом и приводим к нужному нам виду
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

// А тут уже загружаем в Gemini prompt, по которому вдальнейшем будет происходить все взаимодействие клиента и Gemini
async function getResponse(userInput, userId) {
  if (qAndAData.length === 0) {
    console.log('QA Data not loaded yet');
    return 'Данные еще не загружены, попробуйте позже.';
  }

  // Если история для пользователя еще не существует, создаем ее
  if (!userHistory[userId]) {
    userHistory[userId] = [];
  }

  // Добавляем запрос пользователя в историю
  userHistory[userId].push({ role: "user", text: userInput });

  const chatSession = model.startChat({
    generationConfig,
    history: [
      // Начинаем историю с сообщения пользователя
      {
        role: "user", 
        parts: [{ text: userInput }],
      },
      ...userHistory[userId].slice(1).map(item => ({
        role: item.role,  
        parts: [{ text: item.text }],
      })),
      {
        role: "user",
        parts: [
          {
            text: `Ты бот компании SilkWay. Пользователь задаёт вопрос: "${userInput}". Ответь по следующим инструкциям:
               ${qAndAData.map(data => `Вопрос: ${data.question}, Ответ: ${data.answer}`).join('\n')} 
                  Ответ должен быть ясным и информативным.
                  Соблюдай формальный стиль.
                  Также если будут схожие вопросы из этого списка, ответь на них в таком же контексте
                  Перефразируй каждую фразу которую ты пишешь, не повторяйся важное условие.
                  Eсли вопрос пользователя не совпадает с вопросами, которые у тебя есть, пиши ему, чтобы он связался с менеджером.
                  Попробуй максимально точно опознать точно ли вопросы пользователя не совпадают с вопросами из списка.
                  Для схожих вопросов используй соответствующие ответы из шаблона.
                  Если вопрос не входит в шаблон, предложи связаться с менеджером.
                  Отправляй только одну ссылку, если она есть в ответах.
          
            `// Последняя строчка для того, чтобы загрузить список вопросов и ответов нашему Gemini, по которому он вдальнейшем будет искать запрос пользователя
          },
        ],
      },
  ]
  });

  try {
    const result = await chatSession.sendMessage(userInput);
    
    // Добавляем ответ бота в историю, изменив роль на "model"
    const botResponseText = typeof result.response.text === 'function' ? result.response.text() : result.response.text;
    userHistory[userId].push({ role: "model", text: botResponseText });

    // Ограничиваем историю, чтобы не переполнять сессию
    if (userHistory[userId].length > 5) {
      userHistory[userId].shift(); // Убираем самое старое сообщение
    }

    return botResponseText;
  } catch (error) {
    console.error("Error:", error);
    return "Ошибка при получении ответа";
  }
}

// Сделали так, для дальнейшего получения ответа бота в файле bot.js
async function botResponse(userInput, userId) {
  try {
    const response = await getResponse(userInput, userId);
    return response;
  } catch (err) {
    return `Ошибка: ${err}`;
  }
}

module.exports = botResponse;
