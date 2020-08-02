const Discord = require('discord.js');
const Https = require('https');
const Parser = require('node-html-parser');
const Scheduler = require('node-schedule');

const Auth = require('./auth.json');

const client = new Discord.Client();
let schedJob = null,
    schedFunc = null,
    schedChan = '';

function onReady() {
  console.log(`Connected as: ${client.user.username} (${client.user.id})`);
}

function onMessage(msg) {
  if (!amMentioned(msg.mentions)) return;
  if (msg.content.includes('help')) {
    help(msg);
  } else if (msg.content.includes('intro')) {
    intro(msg.channel);
  } else if (msg.content.includes('speak')) {
    speak(msg.channel);
  } else if (msg.content.includes('unfetch')) {
    unfetch(msg);
  } else if (msg.content.includes('fetch')) {
    fetch(msg);
  }
}

function amMentioned(mentions) {
  return (mentions.users.find(u => { return u.id === client.user.id }) ||
    mentions.roles.find(r => { return r.id === client.user.id }));
}

function help(msg) {
  msg.author.send(
    'Retriever commands:\n' +
      ':star: help - Send me this help message\n' +
      ':star: intro - Introduce yourself\n' +
      ':star: speak - Say something\n' +
      ':star: fetch <what> - Fetch something:\n' +
      ':star::star: <blank> A newspaper\n' +
      ':star::star: skywatch - Today\'s Skywatch astrology report\n' +
      ':star::star: aa - Today\'s Astrology Answers card\n'
  );
  msg.channel.send(`Rent you a message, ${msg.author.toString()}`);
}

function intro(channel) {
  channel.send("Ri! I'm Rastro, a rastrorogical retriever. Rif you rask me for `help`, I'll rend you a message.");
}

function speak(channel) {
  const messages = [
      'Ruff!',
      'Ri am the rerry rodel of a rodern ragor-reneral!',
      'Rich ray, Reorge?',
      'Rerro!',
      'Ruh-roh, Raggy!',
      'Rrrrrrrrr!',
      'Rastrorogy rocks!',
      'Rercury retrograde?',
      'Run time, at rand camp, I rucked Ruto',
      'I rav a ream...'
    ],
    index = Math.floor(Math.random() * messages.length);

  channel.send(messages[index]);
}

function fetch(msg) {
  const matches = msg.content.match(/fetch\s+(sky\w*|aa)\s*(in\s+<#(\d+)>)?\s*(at\s+(\d+))?/i);
  if (!matches) return msg.channel.send(':newspaper2:');

  const what = matches[1],
        where = matches[3],
        when = matches[5];
  var channel = msg.channel;

  if (where) {
    const ch = client.channels.cache.get(where);
    if (!ch) return msg.channel.send(`Rorry, ${msg.author.toString()} - couldn\'t find ${where}`);
    channel = ch;
  }

  if (when) return scheduleFetch(msg, channel, what, when);

  what.startsWith('sky') ? fetchSkywatch(channel) : fetchAstrologyAnswers(channel);
}

function scheduleFetch(msg, channel, what, when) {
  const skywatch = what.startsWith('sky');

  if (!msg.member.hasPermission('ADMINISTRATOR')) {
    return msg.channel.send(`Rorry, ${msg.author.toString()} - not arrowed`);
  }

  if (schedJob) schedJob.cancel();
  schedFunc = skywatch ? fetchSkywatch : fetchAstrologyAnswers;
  schedChan = channel;
  schedJob = Scheduler.scheduleJob(`${when} * * *`, () => { schedFunc(schedChan); });
  return msg.channel.send(
    `Rokay, ${msg.author.toString()} - fetching ${skywatch ? 'Skywatch' : 'Astrology Answers'} ` +
      `in ${channel.toString()} every day at ${when}:00`
  );
}

function unfetch(msg) {
  if (!schedJob) return msg.channel.send(`Nothing to unfetch, ${msg.author.toString()}`);
  schedJob.cancel();
  schedJob = null;
  schedFunc = null;
  schedChan = '';
  msg.channel.send(`Rokay, ${msg.author.toString()} - ro more fetching`);
}

function fetchSkywatch(channel) {
  const locale = 'en-US',
        date = new Date(),
        weekday = date.toLocaleString(locale, { weekday: 'long' }),
        month = date.toLocaleString(locale, { month: 'long' }),
        day = date.getDate(),
        url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`;

  Https.get(url, (res) => {
    var html = '';

    res.on('data', (chunk) => html += chunk);
    res.on('end', () => {
      const root = Parser.parse(html),
            el = root.querySelector('.entry-content'),
            entry = el.structuredText.replace(/\n/g, '\n\n');

      channel.send(`**${weekday}, ${month} ${day}**\n\n${entry}\n\nhttps://skywatchastrology.com`);
    });
  }).end();
}

function fetchAstrologyAnswers(channel) {
  const query = '(%23dailyreading)%20(from%3AAstrologyAnswer)',
        args = `q=${query}&result_type=recent&count=1&include_entities=1&tweet_mode=extended`,
        opts = {
          hostname: 'api.twitter.com',
          path: `/1.1/search/tweets.json?${args}`,
          headers: { Authorization: `Bearer ${Auth.twitter}` }
        };

  Https.get(opts, (res) => {
    var body = '';

    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      const payload = JSON.parse(body);
      channel.send(payload.statuses[0].entities.media[0].media_url);
    });
  }).end();
}

client.once('ready', onReady);
client.on('message', onMessage);
client.login(Auth.token);
