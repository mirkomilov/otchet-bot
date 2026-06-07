const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// =============================================
// КЛИЕНТЫ — добавляй сюда своих клиентов
// =============================================
const clients = [
  {
    name: 'Nexus Mebel',
    groupChatId: '-1000000000001', // ID группы в Telegram
    fbAdAccountId: 'act_000000000001', // ID рекламного аккаунта Facebook
  },
  // Добавь следующего клиента так:
  // {
  //   name: 'AutoSalon Tashkent',
  //   groupChatId: '-1000000000002',
  //   fbAdAccountId: 'act_000000000002',
  // },
];

// =============================================
// ПОЛУЧЕНИЕ ДАННЫХ ИЗ FACEBOOK ADS
// =============================================
async function getFacebookStats(adAccountId) {
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().split('T')[0];

  try {
    // Данные за сегодня
    const todayRes = await axios.get(
      `https://graph.facebook.com/v19.0/${adAccountId}/insights`,
      {
        params: {
          access_token: FB_ACCESS_TOKEN,
          time_range: JSON.stringify({ since: today, until: today }),
          fields: 'spend,clicks,reach,actions',
          level: 'account',
        },
      }
    );

    // Данные за месяц
    const monthRes = await axios.get(
      `https://graph.facebook.com/v19.0/${adAccountId}/insights`,
      {
        params: {
          access_token: FB_ACCESS_TOKEN,
          time_range: JSON.stringify({ since: firstDay, until: today }),
          fields: 'spend,clicks,reach,actions',
          level: 'account',
        },
      }
    );

    const todayData = todayRes.data.data[0] || {};
    const monthData = monthRes.data.data[0] || {};

    // Извлекаем лиды и звонки из actions
    const getAction = (data, actionType) => {
      if (!data.actions) return 0;
      const action = data.actions.find(a => a.action_type === actionType);
      return action ? parseInt(action.value) : 0;
    };

    return {
      today: {
        spend: parseFloat(todayData.spend || 0).toFixed(2),
        clicks: todayData.clicks || 0,
        reach: todayData.reach || 0,
        leads: getAction(todayData, 'lead') + getAction(todayData, 'leadgen_grouped'),
        calls: getAction(todayData, 'onsite_conversion.flow_complete'),
      },
      month: {
        spend: parseFloat(monthData.spend || 0).toFixed(2),
        clicks: monthData.clicks || 0,
        reach: monthData.reach || 0,
        leads: getAction(monthData, 'lead') + getAction(monthData, 'leadgen_grouped'),
        calls: getAction(monthData, 'onsite_conversion.flow_complete'),
      },
    };
  } catch (err) {
    console.error('Facebook API error:', err.response?.data || err.message);
    return null;
  }
}

// =============================================
// ФОРМИРОВАНИЕ ТЕКСТА ОТЧЁТА
// =============================================
function buildReport(clientName, stats) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent'
  });

  const todayTotal = parseInt(stats.today.leads) + parseInt(stats.today.calls);
  const monthTotal = parseInt(stats.month.leads) + parseInt(stats.month.calls);

  return `📊 Отчёт за ${dateStr}
Клиент: ${clientName}
━━━━━━━━━━━━━━━

💰 Бюджет
• Потрачено сегодня: $${stats.today.spend}
• За месяц: $${stats.month.spend}

📋 Лиды (формы)
• Сегодня: ${stats.today.leads} лидов
• За месяц: ${stats.month.leads} лидов

📞 Звонки
• Сегодня: ${stats.today.calls} звонков
• За месяц: ${stats.month.calls} звонков

✅ Итого обращений
• Сегодня: ${todayTotal}
• За месяц: ${monthTotal}

━━━━━━━━━━━━━━━
👆 Клики: ${stats.today.clicks} | Охват: ${stats.today.reach}`;
}

// =============================================
// ОТПРАВКА ОТЧЁТА В ГРУППУ
// =============================================
async function sendReport(client) {
  console.log(`Отправляю отчёт для ${client.name}...`);

  const stats = await getFacebookStats(client.fbAdAccountId);
  if (!stats) {
    bot.sendMessage(client.groupChatId, `⚠️ Не удалось получить данные Facebook для ${client.name}`);
    return;
  }

  const text = buildReport(client.name, stats);

  // Сначала отправляем текст
  await bot.sendMessage(client.groupChatId, text);

  // Потом скриншот (если настроен)
  // await bot.sendPhoto(client.groupChatId, screenshotBuffer, { caption: 'Скриншот Facebook Ads Manager' });

  console.log(`✓ Отчёт отправлен для ${client.name}`);
}

// =============================================
// СЛУЧАЙНОЕ ВРЕМЯ МЕЖДУ 23:00 И 23:59 (ТАШКЕНТ)
// Ташкент = UTC+5, значит 23:00 Ташкент = 18:00 UTC
// =============================================
function scheduleRandomNight() {
  clients.forEach((client) => {
    // Случайная минута от 0 до 59
    const randomMinute = Math.floor(Math.random() * 60);
    console.log(`${client.name}: отчёт сегодня в 23:${String(randomMinute).padStart(2, '0')} (Ташкент)`);

    // Запускаем в нужное время (18:XX UTC = 23:XX Ташкент)
    cron.schedule(`${randomMinute} 18 * * *`, () => {
      sendReport(client);
    });
  });
}

// =============================================
// КОМАНДЫ БОТА
// =============================================

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    `👋 Привет! Я бот автоматических отчётов по рекламе.\n\nКаждую ночь отправляю статистику Facebook Ads в группы клиентов.\n\nID этой группы: ${msg.chat.id}`
  );
});

// /test — тестовая отправка прямо сейчас
bot.onText(/\/test/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '⏳ Получаю данные из Facebook...');
  
  // Найдём клиента по chatId или отправим первому
  const client = clients.find(c => c.groupChatId === String(chatId)) || clients[0];
  if (client) {
    await sendReport({ ...client, groupChatId: chatId });
  } else {
    bot.sendMessage(chatId, '❌ Клиент не найден. Добавьте этот чат в список клиентов.');
  }
});

// /id — узнать ID группы
bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `ID этого чата: ${msg.chat.id}`);
});

// /status — статус всех клиентов
bot.onText(/\/status/, (msg) => {
  const list = clients.map((c, i) => `${i+1}. ${c.name} — ${c.groupChatId}`).join('\n');
  bot.sendMessage(msg.chat.id, `📋 Активные клиенты:\n\n${list}`);
});

// =============================================
// ЗАПУСК
// =============================================
console.log('🤖 Бот запущен!');
console.log(`📋 Клиентов: ${clients.length}`);
scheduleRandomNight();
