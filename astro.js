const Discord = require('discord.js');
const Winston = require('winston');
const Https = require('https');
const Parser = require('node-html-parser');
const Scheduler = require('node-schedule');
const Fs = require('fs');

const Auth = require('./auth.json');

const SCHED_DIR = './schedules';
const LOG_FILE = './activity.log';

const logger = Winston.createLogger({
  transports: [
    new Winston.transports.Console({ colorize: true }),
    new Winston.transports.File({ filename: LOG_FILE })
  ],
  format: Winston.format.combine(
    Winston.format.timestamp(),
    Winston.format.simple()
  )
});
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
  },

  Sign: (sign, channel) => {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${sign.toLowerCase()}-daily-horoscope/`;

    fetchData(url, 'Sign Horoscope', (body) => {
      const elem = Parser.parse(body).querySelector('.horoscope_summary'),
            ul = elem.querySelector('ul');

      if (ul) ul.set_content('');

      const entry = elem.structuredText.replace(/\n/g, '\n\n');
      channel.send(`${entry}\n\n${host}`);
    });
  }
};
const signs = {
  ari: 'Aries',
  tau: 'Taurus',
  gem: 'Gemini',
  can: 'Cancer',
  leo: 'Leo',
  vir: 'Virgo',
  lib: 'Libra',
  sco: 'Scorpio',
  sag: 'Sagittarius',
  cap: 'Capricorn',
  aqu: 'Aquarius',
  pis: 'Pisces'
}

function onReady() {
  logger.info(`Connected as: ${client.user.username} (${client.user.id})`);
  readSchedules();
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
  const msg = `Failed to fetch ${name}: ${err}`;

  logger.error(msg);
  listeners.forEach(l => {
    const usr = client.users.cache.get(l);
    usr.send(msg);
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
  const format = `fetch\\s+${whatMatcher()}\\s*(in\\s+<#(\\d+)>)?\\s*(at\\s+(\\d{1,2}))?`,
        exp = new RegExp(format, 'i'),
        matches = msg.content.match(exp);
  if (!matches) return msg.channel.send(':newspaper2:');

  const what = whatArg(matches[1]),
        where = matches[3],
        when = matches[5];
  let channel = msg.channel;

  if (where) {
    const ch = client.channels.cache.get(where);
    if (!ch) return msg.channel.send(`Rorry, ${msg.author.toString()} - couldn\'t find ${where}`);
    channel = ch;
  }

  if (when) return scheduleFetch(msg, channel, what, when);

  fetchWhat(what, channel);
}

function unfetch(msg) {
  const format = `unfetch\\s+${whatMatcher()}\\s*in\\s+<#(\\d+)>`,
        exp = new RegExp(format, 'i'),
        matches = msg.content.match(exp);
  if (!matches) return msg.channel.send(':face_vomiting:');

  const what = whatArg(matches[1]),
        where = matches[2],
        channel = client.channels.cache.get(where),
        chanName = channel ? channel.name : `<#${where}>`;
        jobName = `${what}@${where}`,
        guildId = msg.guild.id,
        guildJobs = jobsForGuild(guildId),
        job = guildJobs[jobName],
        authAt = msg.author.toString();

  if (!job) return msg.channel.send(`Rorry, ${authAt} - not fetching ${what} in ${chanName}`);
  job.sched.cancel();
  delete guildJobs[jobName];
  writeSchedule(guildId);
  msg.channel.send(`Rokay, ${authAt} - ro more fetching ${what} in ${chanName}`);
  logger.info(`${msg.author.username} unscheduled ${what} from ${channel.name}`);
}

function joblist(msg) {
  const guildId = msg.guild.id,
        guildJobs = jobsForGuild(guildId),
        keys = Object.keys(guildJobs),
        lines = keys.map(k => { return jobString(guildId, k); });

  if (!isAdmin(msg)) return;
  msg.channel.send(`Job list:\n${lines.join('\n')}`);
}

function notices(msg) {
  const authId = msg.author.id,
        authAt = msg.author.toString();

  if (listeners.includes(authId)) return msg.channel.send(`You ralready get notices, ${authAt}`);
  if (!isAdmin(msg)) return;
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

function whatMatcher() {
  return `(sky\\w*|aa|${Object.keys(signs).join('\\w*|')}\\w*)`;
}

function whatArg(arg) {
  if (arg.startsWith('sky')) return 'Skywatch';
  else if (arg == 'aa') return 'AstrologyAnswers';
  return signs[arg.slice(0, 3)];
}

function scheduleFetch(msg, channel, what, when) {
  const jobName = `${what}@${channel.id}`,
        guildId = msg.guild.id,
        guildJobs = jobsForGuild(guildId),
        job = guildJobs[jobName],
        authAt = msg.author.toString();

  if (!isAdmin(msg)) return;

  if (job) job.sched.cancel();
  guildJobs[jobName] = { time: when }
  guildJobs[jobName].sched = Scheduler.scheduleJob(`0 ${when} * * *`, () => { runJob(jobName); });
  writeSchedule(guildId);
  msg.channel.send(`Rokay, ${authAt} - fetching ${what} in ${channel.toString()} every day at ${when}:00 GMT`);
  logger.info(`${msg.author.username} scheduled ${what} in ${channel.name} at ${when}`);
}

function fetchWhat(what, channel) {
  switch (what) {
    case 'Skywatch':
    case 'AstrologyAnswers':
      fetchers[what](channel);
      break;
    default:
      fetchers.Sign(what, channel);
      break;
  }
}

function jobsForGuild(guildId) {
  return jobs[guildId] || (jobs[guildId] = {});
}

function runJob(jobName) {
  const [fetcher, channel] = jobArgs(jobName);
  fetchWhat(fetcher, channel);
}

function jobArgs(jobName) {
  const [fetcher, id] = jobName.split('@'),
        channel = client.channels.cache.get(id);
  return [fetcher, channel];
}

function jobString(guildId, jobName) {
  const [fetcher, channel] = jobArgs(jobName),
        when = jobsForGuild(guildId)[jobName].time;
  return `${fetcher} in ${channel.name} at ${when}:00 GMT`;
}

function isAdmin(msg) {
  if (!msg.member.hasPermission('ADMINISTRATOR')) {
    msg.channel.send(`Rorry, ${msg.author.toString()} - not arrowed`);
    return false;
  }
  return true;
}

function fetchData(url, name, onEnd) {
  Https.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => { onEnd(body); });
    res.on('error', (err) => { onError(name, err) });
  }).end();
}

function readSchedules() {
  Fs.readdir(SCHED_DIR, (err, files) => {
    if (err) return logger.error(err);

    files.forEach(f => {
      if (f.startsWith('.')) return;

      Fs.readFile(`${SCHED_DIR}/${f}`, (err, data) => {
        if (err) return logger.error(err);

        const guildJobs = jobsForGuild(f.slice(0, -5));

        Object.entries(JSON.parse(data)).map(([jobName, when]) => {
          guildJobs[jobName] = { time: when }
          guildJobs[jobName].sched = Scheduler.scheduleJob(`0 ${when} * * *`, () => { runJob(jobName); });
        });
      });
    });
  });
}

function writeSchedule(guildId) {
  const guildJobs = jobsForGuild(guildId),
        tree = Object.entries(guildJobs).map(([k, v]) => { return [k, v.time]; }),
        data = JSON.stringify(Object.fromEntries(tree));

  Fs.writeFile(`${SCHED_DIR}/${guildId}.json`, data, err => { if (err) logger.error(err); });
}

client.once('ready', onReady);
client.on('message', onMessage);
client.login(Auth.token);
