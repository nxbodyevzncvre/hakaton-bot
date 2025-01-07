const dotenv = require("dotenv");
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const credentials = require('./credentials.json');
dotenv.config();
const documentId = process.env.DOCUMENT_ID;
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const docs = google.docs('v1');

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
async function getResponse(userInput) {
  if (qAndAData.length === 0) {
    console.log('QA Data not loaded yet');
    return 'Данные еще не загружены, попробуйте позже.';
  }

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            text: `Ты бот компании SilkWay. Пользователь спрашивает: "${userInput}". Сгенерируй ответ, следуя следующим инструкциям:
            ЗАПОМИНАЙ КАЖДОЕ СООБЩЕНИЕ ЧТОБЫ БЫЛ КОНТЕКСТ ТАК НАЗЫВАЕМЫЙ
            1. Ответ должен быть понятным и информативным.
            2. Если информация о грузе недоступна, сообщи об этом.
            3. Придерживайся формального стиля общения.
            4. Используй точные данные, когда это возможно, иначе укажи, что нужно уточнить.
            5. Также если будут схожие вопросы из этого списка, ответь на них в таком же контексте:
            6. Перефразируй каждую фразу которую ты пишешь, не повторяйся важное условие
            7. Eсли вопрос пользователя не совпадает с вопросами, которые у тебя есть, пиши ему, чтобы он связался с менеджером
            8. Попробуй максимально точно опознать точно ли вопросы пользователя не совпадают с вопросами из списка
            9. Если у тебя не получилось найти вопросы в предоставленном тебе списке, то добавь к твоему ответу в конце: Свяжитесь с менеджером.
            10. Запоминай историю сообщения вплоть до 3 сообщения
            ${qAndAData.map(data => `Вопрос: ${data.question}, Ответ: ${data.answer}`).join('\n')} 
          
            `// Последняя строчка для того, чтобы загрузить список вопросов и ответов нашему Gemini, по которому он вдальнейшем будет искать запрос пользователя
          },
        ],
      },
    ],
  });
  // Проверки на введеный текст пользователем
  try {
    const result = await chatSession.sendMessage(userInput);

    if (typeof result.response.text === 'function') {
      return result.response.text(); 
    } else {
      return result.response.text; 
    }
  } catch (error) {
    console.error("Error:", error);
    return "Ошибка при получении ответа";
  }
}
// Сделали так, для дальнейшего получения ответа бота в файле bot.js
async function botResponse(userInput){
  try {
    const response = await getResponse(userInput);
    return response;
  } catch (err) {
    return `Ошибка: ${err}`;
  }
}

module.exports = botResponse;
