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
const fetchers = {
  Skywatch: (target) => {
    const locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate(),
          url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`;

    logger.info(`Fetching ${target.what}`);
    fetchData(url, 'Skywatch', target.guildId, (body) => {
      const elem = Parser.parse(body).querySelector('.entry-content'),
            entry = elem.structuredText.replace(/\n/g, '\n\n');

      logger.info(`Sending ${target.forLog()}`);
      target.recipient.send(`**${weekday}, ${month} ${day}**\n\n${entry}\n\nhttps://skywatchastrology.com`);
    });
  },

  AstrologyAnswers: (target) => {
    const query = '(%23dailyreading)%20(from%3AAstrologyAnswer)',
          args = `q=${query}&result_type=recent&count=1&include_entities=1&tweet_mode=extended`,
          opts = {
            hostname: 'api.twitter.com',
            path: `/1.1/search/tweets.json?${args}`,
            headers: { Authorization: `Bearer ${Auth.twitter}` }
          };

    logger.info(`Fetching ${target.what}`);
    fetchData(opts, 'AstrologyAnswers', target.guildId, (body) => {
      const payload = JSON.parse(body);

      logger.info(`Sending ${target.forLog()}`);
      target.recipient.send(payload.statuses[0].entities.media[0].media_url);
    });
  },

  Sign: (target) => {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${target.what.toLowerCase()}-daily-horoscope/`;

    logger.info(`Fetching ${target.what}`);
    fetchData(url, 'Sign Horoscope', target.guildId, (body) => {
      const elem = Parser.parse(body).querySelector('.horoscope_summary'),
            ul = elem.querySelector('ul');

      if (ul) ul.set_content('');

      const entry = elem.structuredText.replace(/\n/g, '\n\n');

      logger.info(`Sending ${target.forLog()}`);
      target.recipient.send(`${entry}\n\n${host}`);
    });
  }
};
Object.values(signs).forEach(n => { fetchers[n] = fetchers.Sign; });

class MessageTarget {
  constructor({ guildId = 0, what = null, where = null, author = null, who = null, jobName = null }) {
    if (jobName !== null) {
      this.fromString(jobName);
      return;
    }

    if (where) this.channel = client.channels.cache.get(where);
    if (author) {
      this.user = author;
    } else if (who) {
      this.user = client.users.cache.get(who);
    }

    if (!(this.channelObj || this.userObj)) {
      this.error = `couldn\'t find that ${this.isUser ? 'user' : 'channel'}`;
      return;
    }

    this.guildId = guildId;
    this.what = what;
  }

  get user() {
    return this.userObj;
  }

  set user(user) {
    if (user !== null) this.channelObj = null;
    this.userObj = user;
    this.isUser = true;
  }

  get channel() {
    return this.channelObj;
  }

  set channel(channel) {
    if (channel !== null) this.userObj = null;
    this.channelObj = channel;
    this.isUser = false;
  }

  get id() {
    return this.isUser ? this.userObj.id : this.channelObj.id;
  }

  get name() {
    return this.isUser ? this.userObj.username : this.channelObj.name;
  }

  get mention() {
    return this.isUser ? this.userObj.toString() : this.channelObj.toString();
  }

  get recipient() {
    return this.isUser ? this.userObj : this.channelObj;
  }

  get code() {
    return this.isUser ? 'u' : 'c';
  }

  get preposition() {
    return this.isUser ? 'for' : 'in';
  }

  inWords() {
    return `${this.what} ${this.preposition} ${this.mention}`;
  }

  forLog() {
    return `${this.what} to #${this.name}`;
  }

  toString() {
    return `${this.what}@${this.guildId}#${this.code}${this.id}`;
  }

  fromString(jobName) {
    const [_, what, guildId, code, id] = jobName.match(/^(\w+)@(\d+)#([uc])(\d+)/);
    this.what = what;
    this.guildId = guildId;
    this.isUser = code == 'u';
    if (this.isUser) {
      this.user = client.users.cache.get(id);
    } else {
      this.channel = client.channels.cache.get(id);
    }
  }
}

class FetchTime {
  constructor({ hours = 0, minutes = 0, pm = null, tz = null, ms = null }) {
    let time;

    if (ms === null) {
      time = parseInt(hours);

      if (pm) {
        switch (pm.toLowerCase()) {
          case 'pm':
            time += 12;
            break;
          case 'am':
            if (time === 12) time = 0;
            break;
        }
      }
      time *= MS_PER_HOUR;
      if (minutes) time += parseInt(minutes) * MS_PER_MIN;
      if (tz) {
        const offset = Offsets[tz];
        if (!offset) this.error = `ron't know ${tz} timezone`;
        time -= offset * MS_PER_MIN;
      }
    } else {
      time = ms;
    }

    this.date = new Date(time);
  }

  get hours() {
    return this.date.getUTCHours();
  }

  get minutes() {
    return this.date.getUTCMinutes();
  }

  get ms() {
    return this.date.valueOf();
  }

  get gmt() {
    return `${this.hours}:${this.minutes < 10 ? '0' : ''}${this.minutes}`;
  }

  get cron() {
    return `${this.minutes} ${this.hours} * * *`;
  }
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
      ':star2: help - Send me this help message\n' +
      ':star2: intro - Introduce yourself\n' +
      ':star2: speak - Say something\n' +
      ':star2: fetch <what> - Fetch something:\n' +
      '    :star: <blank> A newspaper\n' +
      '    :star: skywatch - Today\'s Skywatch astrology report\n' +
      '    :star: aa - Today\'s Astrology Answers card\n' +
      Object.values(signs).map((v) => { return `    :star: ${v.toLowerCase()} - Today\'s ${v} horoscope\n` }).join('');

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
  const format = `fetch\\s+${whatMatcher()}\\s*(${whereMatcher()}|${whoMatcher()})?\\s*(${atMatcher()})?`,
        exp = new RegExp(format, 'i'),
        matches = msg.content.match(exp);
  if (!matches) return msg.channel.send(':newspaper2:');

  const what = whatArg(matches[1]),
        where = matches[3] || msg.channel.id,
        author = matches[4] === 'me' ? msg.author : null,
        who = matches[5],
        hours = matches[7],
        minutes = matches[9],
        pm = matches[10],
        tz = matches[11],
        target = new MessageTarget({ guildId: msg.guild.id, what, where, author, who });

  if (target.error) return rorry(msg, target.error);

  if (hours) {
    const when = new FetchTime({ hours, minutes, pm, tz });
    if (when.error) return rorry(msg, when.error);
    return scheduleFetch(msg, target, when);
  }

  fetchers[target.what](target);
  if (target.isUser) {
    const same = msg.author.id === target.id;
    rokay(msg, `rent ${target.what} to ${same ? 'you' : target.mention}`);
  }
}

function unfetch(msg) {
  const format = `unfetch\\s+${whatMatcher()}\\s*(${whereMatcher()}|${whoMatcher()})?`,
        exp = new RegExp(format, 'i'),
        matches = msg.content.match(exp);
  if (!matches) return msg.channel.send(':face_vomiting:');

  const what = whatArg(matches[1]),
        where = matches[3] || msg.channel.id,
        author = matches[4] === 'me' ? msg.author : null,
        who = matches[5],
        target = new MessageTarget({ guildId: msg.guild.id, what, where, author, who });
  if (!(target.id === msg.author.id || isAdmin(msg))) return;

  const jobName = target.toString(),
        guildJobs = jobsForGuild(target.guildId),
        job = guildJobs[jobName];

  if (!job) return rorry(msg, `not fetching ${target.inWords()}`);
  job.sched.cancel();
  delete guildJobs[jobName];
  writeSchedule(target.guildId);
  rokay(msg, `ro more fetching ${target.inWords()}`);
  logger.info(`${msg.author.username} unscheduled ${target.forLog()}`);
}

function joblist(msg) {
  if (!isAdmin(msg)) return;

  const guildJobs = jobsForGuild(msg.channel.guild.id),
        lines = Object.keys(guildJobs).map(k => { return jobString(k); });

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

function whereMatcher() {
  return 'in\\s+<#(\\d+)>';
}

function whoMatcher() {
  return 'for\\s+(me|<@!?(\\d+)>)';
}

function atMatcher() {
  return 'at\\s+(\\d{1,2})(:(\\d{2}))?([ap]m)?\\s*([A-Z]{1,3})?';
}

function whatArg(arg) {
  if (arg.startsWith('sky')) return 'Skywatch';
  else if (arg == 'aa') return 'AstrologyAnswers';
  return signs[arg.slice(0, 3)];
}

function scheduleFetch(msg, target, when) {
  if (!(target.id === msg.author.id || isAdmin(msg))) return;

  const jobName = target.toString(),
        guildJobs = jobsForGuild(target.guildId),
        job = guildJobs[jobName];

  if (job) job.sched.cancel();
  guildJobs[jobName] = { time: when.ms }
  guildJobs[jobName].sched = Scheduler.scheduleJob(when.cron, () => { runJob(jobName); });
  writeSchedule(target.guildId);
  rokay(msg, `fetching ${target.inWords()} every day at ${when.gmt} GMT`);
  logger.info(`${msg.author.username} scheduled ${target.forLog()} at ${when.gmt}`);
}

function listenersForGuild(guildId) {
  return listeners[guildId] || (listeners[guildId] = []);
}

function jobsForGuild(guildId) {
  return jobs[guildId] || (jobs[guildId] = {});
}

function runJob(jobName) {
  const target = new MessageTarget({ jobName });

  logger.info(`Running ${target.forLog()}`);
  fetchers[target.what](target);
}

function jobString(jobName) {
  const target = new MessageTarget({ jobName }),
        ms = jobsForGuild(target.guildId)[jobName].time,
        when = new FetchTime({ ms });
  return `${target.inWords()} at ${when.gmt} GMT`;
}

function listenerString(userId) {
  const usr = client.users.cache.get(userId);
  return `${user.toString}`;
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

        Object.entries(JSON.parse(data)).map(([jobName, ms]) => {
          const when = new FetchTime({ ms });

          guildJobs[jobName] = { time: ms }
          guildJobs[jobName].sched = Scheduler.scheduleJob(when.cron, () => { runJob(jobName); });
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
