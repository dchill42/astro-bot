const Discord = require('discord.js');
const Winston = require('winston');
const Fs = require('fs');
const Reader = require('read-last-lines');

const Auth = require('./auth.json');
const Communicator = require('./communicator');
const MessageContext = require('./message_context');
const FetchTarget = require('./fetch_target');
const FetchTime = require('./fetch_time');
const Fetcher = require('./fetcher');
const Scheduler = require('./scheduler');
const Listeners = require('./listeners');

const { LOG_FILE, SIGNS } = require('./constants');

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
    this.cache = null;
    this.listeners = null;
    this.fetcher = null;
    this.scheduler = null;

    this.reactors = [
      'dog',
      'dogs',
      'canine',
      'canines'
    ];
    this.commands = [
      'help',
      'intro',
      'introduce',
      'speak',
      'bang',
      'fetch',
      'unfetch',
      'joblist',
      'notices',
      'shush',
      'notifylist',
      'loglines'
    ];
    const aliases = {
      introduce: 'intro',
      dogs: 'dog',
      canine: 'dog',
      canines: 'dog'
    };
    Object.entries(aliases).forEach(([k, v]) => this[k] = this[v]);
  }

  login(token) {
    this.client.once('ready', this.onReady.bind(this));
    this.client.on('message', this.onMessage.bind(this));
    this.client.login(token);
  }

  onReady() {
    this.logger.info(`Connected as: ${this.client.user.username} (${this.client.user.id})`);

    this.cache = { users: this.client.users.cache, channels: this.client.channels.cache };
    this.listeners = new Listeners(this.logger, this.cache);
    this.fetcher = new Fetcher(this.logger, this.cache, this.listeners);
    this.scheduler = new Scheduler(this.logger, this.cache, this.fetcher);
  }

  onMessage(msg) {
    const ctx = new MessageContext(msg, this.client.user.id, this.cache),
          rmatcher = `\\b(${this.reactors.join('|')})\\b`,
          rregex = new RegExp(rmatcher, 'i'),
          rmatches = ctx.content.match(rregex);
    if (rmatches) {
      const key = rmatches[1];
      try {
        this[key](ctx);
      } catch (err) {
        this.logger.error(`Reaction error: ${err}`);
      }
    }

    if (!(ctx.receivedDm || ctx.mentioned)) return;

    const cmatcher = `\\b(${this.commands.join('|')})\\b`,
          cregex = new RegExp(cmatcher, 'i'),
          cmatches = ctx.content.match(cmatcher);
    if (!cmatches) return;

    const cmd = cmatches[1];
    try {
      this[cmd](ctx);
    } catch (err) {
      this.logger.error(`Command error: ${err}`);
    }
  }

  help(ctx) {
    const names = Object.values(SIGNS),
          lines = names.map(v => `        :star: ${v.toLowerCase()} - Today\'s ${v} horoscope`),
          cmds = 'Retriever commands:\n' +
            ':stars: help - Send me this help message\n' +
            ':stars: intro - Introduce yourself\n' +
            ':stars: speak - Say something\n' +
            ':stars: bang - Play bang-bang-you\'re dead\n' +
            ':stars: fetch <what> (for me (at <time>)) - Fetch something:\n' +
            '    :star2: <what> - What to fetch:\n' +
            '        :star: <blank> - A newspaper\n' +
            '        :star: skywatch - Today\'s Skywatch astrology report\n' +
            '        :star: aa - Today\'s Astrology Answers card\n' +
            lines.join('\n') + '\n' +
            '    :star2: for me - Fetch it in a DM to me\n' +
            '    :star2: at <time - Fetch it every day at <time>:\n' +
            '        :star: e.g.: 3:30pm EST\n' +
            '        :star: or: 17:00 MDT\n' +
            '        :star: or: 12am GMT\n' +
            ':stars: unfetch <what> - Stop fetching something:\n' +
            '    :star2: <blank> - Puke\n' +
            '    :star2: The <what> you said to fetch before';

    ctx.direct(cmds);
    ctx.inform(`Rent you a message, ${ctx.author.toString()}`);
  }

  intro(ctx) {
    ctx.reply('Ri! I\'m Rastro, a rastrorogical retriever. Rif you rask me for `help`, I\'ll rend you a message.');
    this.logActivity(ctx, 'requested an introduction');
  }

  speak(ctx) {
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

    ctx.reply(messages[index]);
    this.logActivity(ctx, 'said speak');
  }

  bang(ctx) {
    ctx.reply(ctx.authorAvatar);
    ctx.reply('🔫');
    ctx.reply(ctx.myAvatar);
    ctx.reply('💀');
    this.logActivity(ctx, 'played bang');
  }

  dog(ctx) {
    ctx.react('🦴');
  }

  fetch(ctx) {
    const whereWho = `(${this.whereMatcher}|${this.whoMatcher})?`,
          atMatcher = 'at\\s+(\\d{1,2})(:(\\d{2}))?([ap]m)?\\s*([A-Z]{1,3})?',
          format = `fetch\\s+${this.whatMatcher}\\s*${whereWho}\\s*(${atMatcher})?`,
          exp = new RegExp(format, 'i'),
          matches = ctx.content.match(exp);
    if (!matches) return ctx.reply('🗞');

    const target = this.getTarget(ctx, matches);
    if (!target) return ctx.reply(this.notArrowed(ctx));
    if (target.error) return ctx.reply(this.rorry(ctx, target.error));

    const hours = matches[7],
          minutes = matches[9],
          pm = matches[10],
          tz = matches[11];
    if (hours) {
      const when = new FetchTime({ hours, minutes, pm, tz });
      if (when.error) return ctx.reply(this.rorry(ctx, when.error));
      if (!(target.id === ctx.author.id || ctx.fromAdmin)) return ctx.reply(this.notArrowed(ctx));
      this.scheduler.scheduleJob(target, when);
      ctx.reply(this.rokay(ctx, `fetching ${target.inWords()} every day at ${when.gmt} GMT`));
      this.logger.info(`${ctx.author.name} scheduled ${target.forLog()} at ${when.gmt}`);
      return;
    }

    this.fetcher.dispatch(target);
    if (target.isUser) {
      const same = ctx.author.id === target.id,
            reply = `rent ${target.what} to ${same ? 'you' : target.recipient.mention}`;
      this.ctx.reply(this.rokay(ctx, reply));
      this.logActivity(ctx, `requested ${target.what}`);
    }
  }

  unfetch(ctx) {
    const format = `unfetch\\s+${this.whatMatcher}\\s*(${this.whereMatcher}|${this.whoMatcher})?`,
          exp = new RegExp(format, 'i'),
          matches = ctx.content.match(exp);
    if (!matches) return ctx.reply('🤮');

    const target = this.getTarget(ctx, matches);
    if (!target) return ctx.reply(this.notArrowed(ctx));
    if (target.error) return ctx.reply(this.rorry(ctx, target.error));

    if (!this.scheduler.cancelJob(target)) return ctx.reply(this.rorry(ctx, `not fetching ${target.inWords()}`));
    ctx.reply(this.rokay(ctx, `ro more fetching ${target.inWords()}`));
    this.logger.info(`${ctx.author.name} unscheduled ${target.forLog()}`);
  }

  joblist(ctx) {
    if (!ctx.fromAdmin) return ctx.reply(this.notArrowed(ctx));
    const list = this.scheduler.listJobs(ctx.guildId);
    ctx.reply(`Job rist:\n${list ? list : '_no jobs_'}`);
    this.logActivity(ctx, 'requested job list');
  }

  notices(ctx) {
    if (!ctx.fromAdmin) return this.notArrowed(ctx);
    if (this.listeners.add(ctx.guildId, ctx.author.id)) return ctx.reply(this.rokay(ctx, `I'll rend you notices`));
    ctx.reply(`You ralready get notices, ${ctx.author.mention}`);
    this.logActivity(ctx, 'requested notices');
  }

  shush(ctx) {
    if (this.listeners.remove(ctx.guildId, msg.author.id)) return ctx.reply(this.rokay(ctx, `ro more notices`));
    ctx.reply(`I don't rend you notices, ${ctx.author.mention}`);
    this.logActivity(ctx, 'shushed notices');
  }

  notifylist(ctx) {
    if (!ctx.fromAdmin) return ctx.reply(this.notArrowed(ctx));
    const list = this.listeners.list(ctx.guildId);
    ctx.reply(`Notify list:\n${list ? list : 'no notifiers'}`);
    this.logActivity(ctx, 'requested notifiers list');
  }

  loglines(ctx) {
    if (!ctx.fromAdmin) return ctx.reply(this.notArrowed(ctx));
    const matches = ctx.content.match(/((\d+)\s+)loglines/i),
          count = matches ? parseInt(matches[2]) : 10;

    Reader.read(LOG_FILE, count)
      .then(lines => ctx.reply(`Rog rines:\n${lines}`))
      .catch(err => this.logger.error(err));

    this.logActivity(ctx, `requested ${count} log lines`);
  }

  getTarget(ctx, matches) {
    const what = matches[1],
          where = Communicator.byId(matches[3], false, ctx.cache) || ctx.channel,
          author = matches[4] === 'me' ? ctx.author : null,
          who = Communicator.byId(matches[5], true, ctx.cache),
          recipient = who || author || where,
          target = new FetchTarget({ guildId: ctx.guildId, what, recipient });

    return (target.id === ctx.author.id || ctx.fromAdmin) ? target : null;
  }

  logActivity(ctx, didWhat) {
    this.logger.info(`${ctx.author.name} ${didWhat} in ${ctx.channel.name}`);
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
    return `(sky\\w*|astro\\w*|aa|${Object.keys(SIGNS).join('\\w*|')}\\w*)`;
  }

  get whereMatcher() {
    return 'in\\s+<#(\\d+)>';
  }

  get whoMatcher() {
    return 'for\\s+(me|<@!?(\\d+)>)';
  }
}

const astro = new Astro();
astro.login(Auth.token);
