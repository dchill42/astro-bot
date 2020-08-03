const Discord = require('discord.js');
const Https = require('https');
const Parser = require('node-html-parser');
const Scheduler = require('node-schedule');

const Auth = require('./auth.json');

const client = new Discord.Client();
const jobs = {};
const listeners = [];
const fetchers = {
  Skywatch: (channel) => {
    const locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate(),
          url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`;

    fetchData(url, 'Skywatch', (body) => {
      const elem = Parser.parse(body).querySelector('.entry-content'),
            entry = elem.structuredText.replace(/\n/g, '\n\n');
      channel.send(`**${weekday}, ${month} ${day}**\n\n${entry}\n\nhttps://skywatchastrology.com`);
    });
  },

  AstrologyAnswers: (channel) => {
    const query = '(%23dailyreading)%20(from%3AAstrologyAnswer)',
          args = `q=${query}&result_type=recent&count=1&include_entities=1&tweet_mode=extended`,
          opts = {
            hostname: 'api.twitter.com',
            path: `/1.1/search/tweets.json?${args}`,
            headers: { Authorization: `Bearer ${Auth.twitter}` }
          };

    fetchData(opts, 'AstrologyAnswers', (body) => {
      const payload = JSON.parse(body);
      channel.send(payload.statuses[0].entities.media[0].media_url);
    });
  }
};

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
  } else if (msg.content.includes('joblist')) {
    joblist(msg);
  } else if (msg.content.includes('notices')) {
    notices(msg);
  } else if (msg.content.includes('shush')) {
    shush(msg);
  }
}

function amMentioned(mentions) {
  return (mentions.users.find(u => { return u.id === client.user.id }) ||
    mentions.roles.find(r => { return r.id === client.user.id }));
}

function onError(name, err) {
  listeners.forEach((l) => {
    const usr = client.users.cache.get(l);
    usr.send(`Failed to fetch ${name}: ${err}`);
  });
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

  const what = fetchWhat(matches[1]),
        where = matches[3],
        when = matches[5];
  let channel = msg.channel;

  if (where) {
    const ch = client.channels.cache.get(where);
    if (!ch) return msg.channel.send(`Rorry, ${msg.author.toString()} - couldn\'t find ${where}`);
    channel = ch;
  }

  if (when) return scheduleFetch(msg, channel, what, when);

  fetchers[what](channel);
}

function unfetch(msg) {
  const matches = msg.content.match(/unfetch\s+(sky\w*|aa)\s*in\s+<#(\d+)>/i);
  if (!matches) return msg.channel.send(':face_vomiting:');

  const what = fetchWhat(matches[1]),
        where = matches[2],
        channel = client.channels.cache.get(where),
        chanName = channel ? channel.name : `<#${where}>`;
        jobName = `${what}@${where}`,
        job = jobs[jobName],
        authAt = msg.author.toString();

  if (!job) return msg.channel.send(`Rorry, ${authAt} - not fetching ${what} in ${chanName}`);
  job.cancel();
  delete jobs[jobName];
  msg.channel.send(`Rokay, ${authAt} - ro more fetching ${what} in ${chanName}`);
}

function joblist(msg) {
  const keys = Object.keys(jobs),
        lines = keys.map(k => { return jobString(k); });

  if (!msg.member.hasPermission('ADMINISTRATOR')) {
    return msg.channel.send(`Rorry, ${msg.author.toString()} - eyes only`);
  }
  msg.channel.send(`Job list:\n${lines.join('\n')}`);
}

function notices(msg) {
  const authId = msg.author.id,
        authAt = msg.author.toString();

  if (listeners.includes(authId)) return msg.channel.send(`You ralready get notices, ${authAt}`);
  if (!msg.member.hasPermission('ADMINISTRATOR')) return msg.channel.send(`Rorry, ${authAt} - eyes only`);
  listeners.push(authId);
  msg.channel.send(`Rokay, ${authAt} - I'll rend you notices`);
}

function shush(msg) {
  const index = listeners.indexOf(msg.author.id),
        authAt = msg.author.toString();

  if (index < 0) return msg.channel.send(`I don't rend you notices, ${authAt}`);
  listeners.splice(index, 1);
  msg.channel.send(`Rokay, ${authAt} - ro more notices`);
}

function fetchWhat(arg) {
  if (arg.startsWith('sky')) return 'Skywatch';
  return 'AstrologyAnswers';
}

function scheduleFetch(msg, channel, fetcher, when) {
  const jobName = `${fetcher}@${channel.id}`,
        job = jobs[jobName],
        authAt = msg.author.toString();

  if (!msg.member.hasPermission('ADMINISTRATOR')) return msg.channel.send(`Rorry, ${authAt} - not arrowed`);

  if (job) job.cancel();
  jobs[jobName] = Scheduler.scheduleJob(`${when} * * *`, () => { runJob(jobName); });
  msg.channel.send(`Rokay, ${authAt} - fetching ${fetcher} in ${channel.toString()} every day at ${when}:00`);
}

function runJob(jobName) {
  const [fetcher, channel] = jobArgs(jobName);
  fetchers[fetcher](channel);
}

function jobArgs(jobName) {
  const [fetcher, id] = jobName.split('@'),
        channel = client.channels.cache.get(id);
  return [fetcher, channel];
}

function jobString(jobName) {
  const [fetcher, channel] = jobArgs(jobName);
  return `${fetcher} in ${channel.name}`;
}

function fetchData(url, name, onEnd) {
  Https.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => { onEnd(body); });
    res.on('error', (err) => { onError(name, err) });
  }).end();
}

client.once('ready', onReady);
client.on('message', onMessage);
client.login(Auth.token);
