const Discord = require('discord.js');
const Winston = require('winston');
const Https = require('https');
const Parser = require('node-html-parser');
const Cron = require('node-schedule');
const Offsets = require('timezone-abbr-offsets');
const Fs = require('fs');

const Auth = require('./auth.json');

const SCHED_DIR = './schedules';
const LIST_DIR = './listeners';
const LOG_FILE = './activity.log';
const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const SIGNS = {
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

class MessageContext {
  constructor(msg) {
    this.content = msg.content;
    this.mentions = msg.mentions;
    this.channel = new Communicator(msg.channel, false);
    this.author = new Communicator(msg.author, true);
    this.fromAdmin = msg.member && msg.member.hasPermission('ADMINISTRATOR');
    this.isDm = msg.channel.type == 'dm';
    this.guildId = msg.guild ? msg.guild.id : this.commonGuild(msg.channel);
  }

  commonGuild(channel) {
    const gids_a = channel.client.guilds.cache.map(g => g.id),
          gids_b = channel.recipient.client.guilds.cache.map(g => g.id);

    return gids_a.filter(g => gids_b.includes(g)).first();
  }

  mentioned(id) {
    return (this.mentions.users.find(u => { return u.id === id }) ||
      this.mentions.roles.find(r => { return r.id === id }));
  }
}

class Communicator {
  constructor(entity, isUser) {
    this.isUser = isUser;
    this.id = entity.id;
    this.name = isUser ? entity.username : entity.name;
    this.mention = entity.toString();
  }

  get code() {
    return this.isUser ? 'u' : 'c';
  }

  get preposition() {
    return this.isUser ? 'for' : 'in';
  }

  static byId(id, isUser) {
    if (id === null) return null;
    const entity = isUser ? client.users.cache.get(id) : client.channels.cache.get(id);
    return new Communicator({ entity, isUser });
  }
}

class MessageTarget {
  constructor({ guildId, what, recipient }) {
    if (!recipient) {
      this.error = 'couldn\'t find that recipient';
      return;
    }

    this.guildId = guildId;
    this.what = this.normalizeWhat(what);
    this.recipient = recipient;
  }

  normalizeWhat(what) {
    if (what.startsWith('sky')) return 'Skywatch';
    else if (what == 'aa') return 'AstrologyAnswers';
    return SIGNS[what.slice(0, 3)];
  }

  get id() {
    return this.recipient.id;
  }

  get isUser() {
    return this.recipient.isUser;
  }

  inWords() {
    return `${this.what} ${this.recipient.preposition} ${this.recipient.mention}`;
  }

  forLog() {
    return `${this.what} to #${this.recipient.name}`;
  }

  toString() {
    return `${this.what}@${this.guildId}#${this.recipient.code}${this.recipient.id}`;
  }

  static fromString(jobName) {
    const [_, what, guildId, code, id] = jobName.match(/^(\w+)@(\d+)#([uc])(\d+)/),
          isUser = code == 'u',
          recipient = Communicator.byId(id, isUser);

    return new MessageContext({ guildId, what, recipient });
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

class Fetcher {
  constructor(logger, cache, listeners) {
    this.logger = logger;
    this.cache = cache;
    this.listeners = listeners;
    Object.values(SIGNS).forEach(n => { this[n] = this.Sign; });
  }

  dispatch(target) {
    this[target.what](target);
  }

  Skywatch(target) {
    const locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate(),
          url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`;

    this.logger.info(`Fetching ${target.what}`);
    this.fetchData(url, target, (body) => {
      const elem = Parser.parse(body).querySelector('.entry-content'),
            entry = elem.structuredText.replace(/\n/g, '\n\n');

      this.logger.info(`Sending ${target.forLog()}`);
      this.send(target, `**${weekday}, ${month} ${day}**\n\n${entry}\n\nhttps://skywatchastrology.com`);
    });
  }

  AstrologyAnswers(target) {
    const query = '(%23dailyreading)%20(from%3AAstrologyAnswer)',
          args = `q=${query}&result_type=recent&count=1&include_entities=1&tweet_mode=extended`,
          opts = {
            hostname: 'api.twitter.com',
            path: `/1.1/search/tweets.json?${args}`,
            headers: { Authorization: `Bearer ${Auth.twitter}` }
          };

    this.logger.info(`Fetching ${target.what}`);
    this.fetchData(opts, target, (body) => {
      const payload = JSON.parse(body);

      this.logger.info(`Sending ${target.forLog()}`);
      this.send(target, payload.statuses[0].entities.media[0].media_url);
    });
  }

  Sign(target) {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${target.what.toLowerCase()}-daily-horoscope/`;

    this.logger.info(`Fetching ${target.what}`);
    this.fetchData(url, target, (body) => {
      const elem = Parser.parse(body).querySelector('.horoscope_summary'),
            ul = elem.querySelector('ul');

      if (ul) ul.set_content('');

      const entry = elem.structuredText.replace(/\n/g, '\n\n');

      this.logger.info(`Sending ${target.forLog()}`);
      this.send(target, `${entry}\n\n${host}`);
    });
  }

  fetchData(url, target, onEnd) {
    Https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => { onEnd(body); });
      res.on('error', (err) => { this.onError(target, err) });
    }).end();
  }

  send(target, data) {
    if (target.isUser) {
      this.cache.users.get(target.id).send(data);
    } else {
      this.cache.channels.get(target.id).send(data);
    }
  }

  onError(target, err) {
    const msg = `Failed to fetch ${target.what}: ${err}`;

    this.logger.error(msg);
    this.listeners.send(target.guildId, msg);
  }
}

class Scheduler {
  constructor(logger, fetcher) {
    this.logger = logger;
    this.fetcher = fetcher;
    this.jobs = {};
    this.readJobs();
  }

  scheduleJob(target, when) {
    const jobName = target.toString(),
          guildJobs = this.jobsForGuild(target.guildId),
          job = guildJobs[jobName];

    if (job) job.schedule.cancel();
    guildJobs[jobName] = { time: when.ms }
    guildJobs[jobName].schedule = Cron.scheduleJob(when.cron, () => { this.runJob(jobName); });
    this.writeJobs(target.guildId);
  }

  cancelJob(target) {
    const jobName = target.toString(),
          guildJobs = this.jobsForGuild(target.guildId),
          job = guildJobs[jobName];

    if (!job) return false;
    job.sched.cancel();
    delete guildJobs[jobName];
    this.writeJobs(target.guildId);
    return true;
  }

  runJob(jobName) {
    const target = MessageTarget.fromString(jobName);

    this.logger.info(`Running ${target.forLog()}`);
    this.fetcher.dispatch(target);
  }

  listJobs(guildId) {
    const guildJobs = this.jobsForGuild(guildId);
    return Object.keys(guildJobs).map(k => { return this.jobString(k); }).join('\n');
  }

  jobString(jobName) {
    const target = MessageTarget.fromSring(jobName),
          ms = this.jobsForGuild(target.guildId)[jobName].time,
          when = new FetchTime({ ms });
    return `${target.inWords()} at ${when.gmt} GMT`;
  }

  readJobs() {
    Fs.readdir(SCHED_DIR, (err, files) => {
      if (err) return this.logger.error(err);

      files.forEach(f => {
        if (f.startsWith('.')) return;

        Fs.readFile(`${SCHED_DIR}/${f}`, (err, data) => {
          if (err) return this.logger.error(err);

          const guildJobs = this.jobsForGuild(f.slice(0, -5));

          Object.entries(JSON.parse(data)).map(([jobName, ms]) => {
            const when = new FetchTime({ ms });

            guildJobs[jobName] = { time: ms }
            guildJobs[jobName].schedule = Cron.scheduleJob(when.cron, () => { runJob(jobName); });
          });
        });
      });
    });
  }

  writeJobs(guildId) {
    const guildJobs = this.jobsForGuild(guildId),
          tree = Object.entries(guildJobs).map(([k, v]) => { return [k, v.time]; }),
          data = JSON.stringify(Object.fromEntries(tree));

    Fs.writeFile(`${SCHED_DIR}/${guildId}.json`, data, err => { if (err) this.logger.error(err); });
  }

  jobsForGuild(guildId) {
    return this.jobs[guildId] || (this.jobs[guildId] = {});
  }
}

class Listeners {
  constructor(logger, cache) {
    this.logger = logger;
    this.cache = cache;
    this.listeners = {};
  }

  add(guildId, id) {
    const guildLists = this.forGuild(guildId);

    if (guildLists.includes(id)) return false;
    guildLists.push(id);
    this.save(guildId);
    return true;
  }

  remove(guildId, id) {
    const guildLists = this.forGuild(guildId),
          index = guildLists.indexOf(id);

    if (index < 0) return false;
    guildLists.slice(index, 1);
    this.save(guildId);
    return true;
  }

  list(guildId) {
    const guildLists = this.forGuild(guildId);
    return guildLists.map(l => { return this.cache.users.get(l).toString(); }).join('\n');
  }

  send(guildId, data) {
    this.forGuild(guildId).forEach(l => this.cache.users.get(l).send(msg));
  }

  forGuild(guildId) {
    return this.listeners[guildId] || (this.listeners[guildId] = []);
  }

  load() {
    Fs.readdir(LIST_DIR, (err, files) => {
      if (err) return this.logger.error(err);

      files.forEach(f => {
        if (f.startsWith('.')) return;

        Fs.readFile(`${LIST_DIR}/${f}`, (err, data) => {
          if (err) return this.logger.error(err);

          const guildId = f.slice(0, -5);
          this.listeners[guildId] = JSON.parse(data);
        });
      });
    });
  }

  save(guildId) {
    const guildLists = this.forGuild(guildId),
          data = JSON.stringify(guildLists);

    Fs.writeFile(`${LIST_DIR}/${guildId}.json`, data, err => { if (err) this.logger.error(err); });
  }
}

class Astro {
  constructor() {
    this.logger = Winston.createLogger({
      transports: [
        new Winston.transports.Console({ colorize: true }),
        new Winston.transports.File({ filename: LOG_FILE })
      ],
      format: Winston.format.combine(
        Winston.format.timestamp(),
        Winston.format.simple()
      )
    });
    this.client = new Discord.Client();
    this.cache = { users: this.client.users.cache, channels: this.client.channels.cache };
    this.listeners = new Listeners(this.logger, this.cache);
    this.fetcher = new Fetcher(this.logger, this.cache, this.listeners);
    this.scheduler = new Scheduler(this.logger, this.fetcher);

    this.client.once('ready', this.onReady);
    this.client.on('message', this.onMessage);
  }

  login(token) {
    this.client.login(token);
  }

  onReady() {
    this.logger.info(`Connected as: ${this.client.user.username} (${this.client.user.id})`);
    this.listeners.load();
  }

  onMessage(msg) {
    const ctx = new MessageContext(msg);
    if (!(ctx.isDm || ctx.mentioned(this.client.user.id))) return;

    const matcher = /\b(help|intro|speak|fetch|unfetch|joblist|notices|shush|notifylist)\b/i,
          [_, cmd] = ctx.content.match(matcher);

    if (!cmd) return;
    const res = this[cmd](ctx);
    if (typeof res == 'string') return msg.channel.send(res);
    if (res.author) msg.author.send(res.author);
    if (res.channel) msg.channel.send(res.channel);
  }

  help(ctx) {
    const names = Object.values(SIGNS),
          lines = names.map(v => `    :star: ${v.toLowerCase()} - Today\'s ${v} horoscope`),
          cmds = 'Retriever commands:\n' +
            ':star2: help - Send me this help message\n' +
            ':star2: intro - Introduce yourself\n' +
            ':star2: speak - Say something\n' +
            ':star2: fetch <what> - Fetch something:\n' +
            '    :star: <blank> A newspaper\n' +
            '    :star: skywatch - Today\'s Skywatch astrology report\n' +
            '    :star: aa - Today\'s Astrology Answers card\n' +
            lines.join('\n');

    return { author: cmds, channel: `Rent you a message, ${ctx.author.toString()}` };
  }

  intro() {
    return 'Ri! I\'m Rastro, a rastrorogical retriever. Rif you rask me for `help`, I\'ll rend you a message.';
  }

  speak() {
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

    return messages[index];
  }

  fetch(ctx) {
    const format = `fetch\\s+${this.whatMatcher}\\s*(${this.whereMatcher}|${this.whoMatcher})?\\s*(${this.atMatcher})?`,
          exp = new RegExp(format, 'i'),
          matches = ctx.content.match(exp);
    if (!matches) return ':newspaper2:';

    const what = matches[1],
          where = Communicator.byId(matches[3], false) || ctx.channel,
          author = matches[4] === 'me' ? ctx.author : null,
          who = Communicator.byId(matches[5], true),
          recipient = who || author || where,
          target = new MessageTarget({ guildId: ctx.guildId, what, recipient });
    if (target.error) return this.rorry(ctx, target.error);

    const hours = matches[7],
          minutes = matches[9],
          pm = matches[10],
          tz = matches[11];
    if (hours) {
      const when = new FetchTime({ hours, minutes, pm, tz });
      if (when.error) return this.rorry(ctx, when.error);
      if (!(target.id === ctx.author.id || ctx.fromAdmin)) return this.notArrowed(ctx);
      this.scheduler.scheduleJob(target, when);
      this.logger.info(`${ctx.author.name} scheduled ${target.forLog()} at ${when.gmt}`);
      return this.rokay(ctx, `fetching ${target.inWords()} every day at ${when.gmt} GMT`);
    }

    this.fetcher.dispatch(target);
    if (target.isUser) {
      const same = ctx.author.id === target.id;
      return this.rokay(ctx, `rent ${target.what} to ${same ? 'you' : target.recipient.mention}`);
    }
  }

  unfetch(ctx) {
    const format = `unfetch\\s+${this.whatMatcher}\\s*(${this.whereMatcher}|${this.whoMatcher})?`,
          exp = new RegExp(format, 'i'),
          matches = ctx.content.match(exp);
    if (!matches) return ':face_vomiting:';

    const what = matches[1],
          where = Communicator.byId(matches[3], false) || ctx.channel,
          author = matches[4] === 'me' ? ctx.author : null,
          who = Communicator.byId(matches[5], true),
          recipient = who || author || where,
          target = new MessageTarget({ guildId: ctx.guildId, what, recipient });
    if (!(target.id === ctx.author.id || ctx.fromAdmin)) return this.notArrowed(ctx);

    if (!cancelJob(target)) return this.rorry(ctx, `not fetching ${target.inWords()}`);
    this.logger.info(`${ctx.author.name} unscheduled ${target.forLog()}`);
    return this.rokay(ctx, `ro more fetching ${target.inWords()}`);
  }

  joblist(ctx) {
    if (!ctx.fromAdmin) return this.notArrowed(ctx);
    const list = this.scheduler.listJobs(ctx.guildId);
    return `Job rist:\n${list ? list : '_no jobs_'}`;
  }

  notices(ctx) {
    if (!ctx.fromAdmin) return this.notArrowed(ctx);
    if (this.listeners.add(ctx.guildId, ctx.author.id)) return this.rokay(ctx, `I'll rend you notices`);
    return `You ralready get notices, ${ctx.author.mention}`;
  }

  shush(ctx) {
    if (this.listeners.remove(ctx.guildId, msg.author.id)) return this.rokay(ctx, `ro more notices`);
    return `I don't rend you notices, ${ctx.author.mention}`;
  }

  notifylist(ctx) {
    if (!ctx.fromAdmin) return this.notArrowed(ctx);
    const list = this.listners.list(ctx.guildId);
    return `Notify list:\n${list ? list : 'no notifiers'}`;
  }

  rokay(ctx, info) {
    return `Rokay, ${ctx.author.mention} - ${info}`;
  }

  rorry(ctx, info) {
    return `Rorry, ${ctx.author.mention} - ${info}`;
  }

  notArrowed(ctx) {
    return this.rorry(ctx, `not arrowed`);
  }

  get whatMatcher() {
    return `(sky\\w*|aa|${Object.keys(SIGNS).join('\\w*|')}\\w*)`;
  }

  get whereMatcher() {
    return 'in\\s+<#(\\d+)>';
  }

  get whoMatcher() {
    return 'for\\s+(me|<@!?(\\d+)>)';
  }

  get atMatcher() {
    return 'at\\s+(\\d{1,2})(:(\\d{2}))?([ap]m)?\\s*([A-Z]{1,3})?';
  }
}

const astro = new Astro();
astro.login(Auth.token);
