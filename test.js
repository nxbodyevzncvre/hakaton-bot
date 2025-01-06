const { google } = require('googleapis');
const { Telegraf } = require('telegraf');
const bot = new Telegraf('7528680194:AAFWvUZiS0ms9Ja2nUSd-dw6DZAhW8XAmOs');
const documentId = '1dI0ZZ1eDFUw0YHHT3BwwMgZqrJhEPoTF3exzB0m-jxg';

// Укажите путь к файлу с учетными данными
const CREDENTIALS_PATH = './credentials.json';

// Загружаем учетные данные
const credentials = require(CREDENTIALS_PATH);

async function getQAFromDocument() {
  return await extractQAFromDocument(documentId);
}

let qAndAData = [];

// Загружаем данные при старте бота
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