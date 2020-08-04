const Discord = require('discord.js');
const Winston = require('winston');
const Https = require('https');
const Parser = require('node-html-parser');
const Scheduler = require('node-schedule');
const Offsets = require('timezone-abbr-offsets');
const Fs = require('fs');

const Auth = require('./auth.json');

const SCHED_DIR = './schedules';
const LIST_DIR = './listeners';
const LOG_FILE = './activity.log';
const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;

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
const listeners = {};
const fetchers = {
  Skywatch: (channel) => {
    const locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate(),
          url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`;

    fetchData(url, 'Skywatch', channel.guild.id, (body) => {
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

    fetchData(opts, 'AstrologyAnswers', channel.guild.id, (body) => {
      const payload = JSON.parse(body);
      channel.send(payload.statuses[0].entities.media[0].media_url);
    });
  },

  Sign: (sign, channel) => {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${sign.toLowerCase()}-daily-horoscope/`;

    fetchData(url, 'Sign Horoscope', channel.guild.id, (body) => {
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
  readListeners();
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
  } else if (msg.content.includes('notifylist')) {
    notifylist(msg);
  }
}

function amMentioned(mentions) {
  return (mentions.users.find(u => { return u.id === client.user.id }) ||
    mentions.roles.find(r => { return r.id === client.user.id }));
}

function onError(name, guildId, err) {
  const msg = `Failed to fetch ${name}: ${err}`;

  logger.error(msg);
  listenersforGuild(guildId).forEach(l => {
    const usr = client.users.cache.get(l);
    usr.send(msg);
  });
}

function help(msg) {
  let cmds = 'Retriever commands:\n' +
      ':star: help - Send me this help message\n' +
      ':star: intro - Introduce yourself\n' +
      ':star: speak - Say something\n' +
      ':star: fetch <what> - Fetch something:\n' +
      ':star::star: <blank> A newspaper\n' +
      ':star::star: skywatch - Today\'s Skywatch astrology report\n' +
      ':star::star: aa - Today\'s Astrology Answers card\n' +
      Object.values(signs).map((v) => { return `:star::star: ${v.toLowerCase()} - Today\'s ${v} horoscope\n` });

  msg.author.send(cmds);
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
  const in_fmt = '(in\\s+<#(\\d+)>)?',
        at_fmt = '(at\\s+(\\d{1,2}))?',
        mn_fmt = '(:(\\d{2}))?',
        pm_fmt = '([ap]m)?',
        tz_fmt = '([A-Z]{1,3})?',
        format = `fetch\\s+${whatMatcher()}\\s*${in_fmt}\\s*${at_fmt}${mn_fmt}${pm_fmt}\\s*${tz_fmt}`,
        exp = new RegExp(format, 'i'),
        matches = msg.content.match(exp);
  if (!matches) return msg.channel.send(':newspaper2:');

  const what = whatArg(matches[1]),
        where = matches[3],
        hours = matches[5],
        minutes = matches[7],
        pm = matches[8],
        tz = matches[9];
  let channel = msg.channel;

  if (where) {
    const ch = client.channels.cache.get(where);
    if (!ch) return rorry(msg, `couldn\'t find ${where}`);
    channel = ch;
  }

  if (hours) {
    const when = whenArg(hours, minutes, pm, tz);
    if (!when) return;
    return scheduleFetch(msg, channel, what, when);
  }

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
        job = guildJobs[jobName];

  if (!job) return rorry(msg, `not fetching ${what} in ${chanName}`);
  job.sched.cancel();
  delete guildJobs[jobName];
  writeSchedule(guildId);
  rokay(msg, `ro more fetching ${what} in ${chanName}`);
  logger.info(`${msg.author.username} unscheduled ${what} from ${channel.name}`);
}

function joblist(msg) {
  if (!isAdmin(msg)) return;

  const guildId = msg.guild.id,
        guildJobs = jobsForGuild(guildId),
        keys = Object.keys(guildJobs),
        lines = keys.map(k => { return jobString(guildId, k); });

  msg.channel.send(`Job list:\n${lines.join('\n')}`);
}

function notices(msg) {
  const guildId = msg.guild.id,
        guildLists = listenersForGuild(guildId),
        authId = msg.author.id,
        authAt = msg.author.toString();

  if (guildLists.includes(authId)) return msg.channel.send(`You ralready get notices, ${authAt}`);
  if (!isAdmin(msg)) return;
  guildLists.push(authId);
  writeListeners(guildId);
  rokay(msg, `I'll rend you notices`);
}

function shush(msg) {
  const guildId = msg.guild.id,
        guildLists = listenersForGuild(guildId),
        index = guildLists.indexOf(msg.author.id),
        authAt = msg.author.toString();

  if (index < 0) return msg.channel.send(`I don't rend you notices, ${authAt}`);
  guildLists.splice(index, 1);
  writeListeners(guildId);
  rokay(msg, `ro more notices`);
}

function notifylist(msg) {
  if (!isAdmin(msg)) return;

  const guildLists = listenersForGuild(msg.guild.id),
        lines = guildLists.map(l => { return client.users.cache.get(l).toString(); });

  msg.channel.send(`Notify list:\n${lines.join('\n')}`);
}

function rokay(msg, info) {
  msg.channel.send(`Rokay, ${msg.author.toString()} - ${info}`);
  return true;
}

function rorry(msg, info) {
  msg.channel.send(`Rorry, ${msg.author.toString()} - ${info}`);
  return false;
}

function whatMatcher() {
  return `(sky\\w*|aa|${Object.keys(signs).join('\\w*|')}\\w*)`;
}

function whatArg(arg) {
  if (arg.startsWith('sky')) return 'Skywatch';
  else if (arg == 'aa') return 'AstrologyAnswers';
  return signs[arg.slice(0, 3)];
}

function whenArg(hours, minutes, pm, tz) {
  let time = parseInt(hours);

  if (pm && pm.toLowerCase() === 'pm') time += 12;
  time *= MS_PER_HOUR;
  if (minutes) time += parseInt(minutes) * MS_PER_MIN;
  if (tz) {
    const offset = Offsets[tz];
    if (!offset) return rorry(msg, `ron't know ${tz} timezone`);
    time -= offset * MS_PER_MIN;
  }
  return new Date(time);
}

function scheduleFetch(msg, channel, what, when) {
  if (!isAdmin(msg)) return;

  const jobName = `${what}@${channel.id}`,
        guildId = msg.guild.id,
        guildJobs = jobsForGuild(guildId),
        job = guildJobs[jobName],
        time = timeString(when, true);

  if (job) job.sched.cancel();
  guildJobs[jobName] = { time: when.valueOf() }
  guildJobs[jobName].sched = Scheduler.scheduleJob(`${timeString(when)} * * *`, () => { runJob(jobName); });
  writeSchedule(guildId);
  rokay(msg, `fetching ${what} in ${channel.toString()} every day at ${time} GMT`);
  logger.info(`${msg.author.username} scheduled ${what} in ${channel.name} at ${time}`);
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

function listenersForGuild(guildId) {
  return listeners[guildId] || (listeners[guildId] = []);
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
        when = new Date(jobsForGuild(guildId)[jobName].time);
  return `${fetcher} in ${channel.toString()} at ${timeString(when, true)} GMT`;
}

function listenerString(userId) {
  const usr = client.users.cache.get(userId);
  return `${user.toString}`;
}

function timeString(when, colon = false) {
  const hours = when.getUTCHours(),
        minutes = when.getUTCMinutes();
  if (colon) return `${hours}:${minutes < 10 ? '0' : ''}${minutes}`;
  return `${minutes} ${hours}`;
}

function isAdmin(msg) {
  if (msg.member.hasPermission('ADMINISTRATOR')) return true;
  return rorry(msg, `not arrowed`);
}

function fetchData(url, name, guildId, onEnd) {
  Https.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => { onEnd(body); });
    res.on('error', (err) => { onError(name, guildId, err) });
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

        Object.entries(JSON.parse(data)).map(([jobName, time]) => {
          const ms = parseInt(time),
                when = new Date(ms);

          guildJobs[jobName] = { time: ms }
          guildJobs[jobName].sched = Scheduler.scheduleJob(`${timeString(when)} * * *`, () => { runJob(jobName); });
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

function readListeners() {
  Fs.readdir(LIST_DIR, (err, files) => {
    if (err) return logger.error(err);

    files.forEach(f => {
      if (f.startsWith('.')) return;

      Fs.readFile(`${LIST_DIR}/${f}`, (err, data) => {
        if (err) return logger.error(err);

        const guildId = f.slice(0, -5);
        listeners[guildId] = JSON.parse(data);
      });
    });
  });
}

function writeListeners(guildId) {
  const guildLists = listenersForGuild(guildId),
        data = JSON.stringify(guildLists);

  Fs.writeFile(`${LIST_DIR}/${guildId}.json`, data, err => { if (err) logger.error(err); });
}

client.once('ready', onReady);
client.on('message', onMessage);
client.login(Auth.token);
