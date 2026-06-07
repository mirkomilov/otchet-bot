const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const clients = [
  {
    name: 'InSeo',
    groupChatId: '-5200672935',
    fbAdAccountId: 'act_283306024430258',
  },
];

async function getFacebookStats(adAccountId) {
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().split('T')[0];

  try {
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

function buildReport(clientName, stats) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent'
  });

  const todayTotal = parseInt(stats.today.leads) + parseInt(stats.today.calls);
  const monthTotal = parseInt(stats.month.leads) + parseInt(stats.month.calls);
  const spendToday = parseFloat(stats.today.spend);

  let warnings = '';
  if (spendToday === 0) {
    warnings += '\n\n⚠️ Реклама сегодня не активна — бюджет не тратится!';
  }
  if (todayTotal === 0 && spendToday > 0) {
    warnings += '\n\n⚠️ Лидов и звонков нет — проверьте настройки рекламы';
  }
  if (todayTotal === 0 && spendToday === 0) {
    warnings += '\n\n💡 Запустите рекламу чтобы начать получать заявки';
  }

  const totalEmoji = todayTotal === 0 ? '😴' : todayTotal < 3 ? '📉' : todayTotal < 10 ? '👍' : '🔥';

  return `📊 Отчёт за ${dateStr}
Клиент: ${clientName}
━━━━━━━━━━━━━━━

💰 Бюджет
- Потрачено сегодня: $${stats.today.spend}
- За месяц: $${stats.month.spend}

📋 Лиды (формы)
- Сегодня: ${stats.today.leads === 0 ? '0 ❌' : stats.today.leads + ' ✅'}
- За месяц: ${stats.month.leads}

📞 Звонки
- Сегодня: ${stats.today.calls === 0 ? '0 ❌' : stats.today.calls + ' ✅'}
- За месяц: ${stats.month.calls}

${totalEmoji} Итого обращений
- Сегодня: ${todayTotal}
- За месяц: ${monthTotal}

━━━━━━━━━━━━━━━
👆 Клики: ${stats.today.clicks} | Охват: ${stats.today.reach}${warnings}`;
}

async function sendReport(client) {
  console.log(`Отправляю отчёт для ${client.name}...`);

  const stats = await getFacebookStats(client.fbAdAccountId);
  if (!stats) {
    bot.sendMessage(client.groupChatId,
      `⚠️ Не удалось получить данные Facebook для ${client.name}\n\nВозможные причины:\n• Задолженность в рекламном кабинете\n• Реклама не запущена\n• Токен устарел`
    );
    return;
  }

  const text = buildReport(client.name, stats);
  await bot.sendMessage(client.groupChatId, text);
  console.log(`✓ Отчёт отправлен для ${client.name}`);
}

function scheduleRandomNight() {
  clients.forEach((client) => {
    const randomMinute = Math.floor(Math.random() * 60);
    console.log(`${client.name}: отчёт сегодня в 23:${String(randomMinute).padStart(2, '0')} (Ташкент)`);
    cron.schedule(`${randomMinute} 18 * * *`, () => {
      sendReport(client);
    });
  });
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Привет! Я бот автоматических отчётов по рекламе.\n\nКаждую ночь отправляю статистику Facebook Ads в группы клиентов.\n\nID этой группы: ${msg.chat.id}`
  );
});

bot.onText(/\/test/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '⏳ Получаю данные из Facebook...');
  const client = clients.find(c => c.groupChatId === String(chatId)) || clients[0];
  if (client) {
    await sendReport({ ...client, groupChatId: chatId });
  } else {
    bot.sendMessage(chatId, '❌ Клиент не найден.');
  }
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `ID этого чата: ${msg.chat.id}`);
});

bot.onText(/\/status/, (msg) => {
  const list = clients.map((c, i) => `${i+1}. ${c.name} — ${c.groupChatId}`).join('\n');
  bot.sendMessage(msg.chat.id, `📋 Активные клиенты:\n\n${list}`);
});

console.log('🤖 Бот запущен!');
console.log(`📋 Клиентов: ${clients.length}`);
scheduleRandomNight();
