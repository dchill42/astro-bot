const Https = require('https');
const Parser = require('node-html-parser');
const Auth = require('./auth.json');
const { SIGNS } = require('./constants');

module.exports = class Fetcher {
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
    const url = 'https://skywatchastrology.com/',
          locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate();

    this.fetchData(url, target, (body, statusCode) => {
      if (statusCode == 404) return this.onError(target, '404');
      const elem = Parser.parse(body).querySelector('#primary #content article .entry-content'),
            text = elem.structuredText.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\n/g, '\n\n'),
            matches = text.match(/\d{1,2}:\d\d\s*([aApP][mM])?\s*(P[SD]T)?/g),
            timereg = /(\d{1,2}):(\d\d)\s*([aApP][mM])?(\s*)(P[SD]T)?/;
      let entry = text;

      matches.forEach(m => {
        const parts = m.match(timereg),
              minutes = parts[2],
              space = parts[4] ? parts[4] : '',
              zone = parts[5] ? parts[5].replace('P', 'E') : '';
        let hour = parseInt(parts[1]),
            ampm = parts[3] ? parts[3].toLowerCase() : 'am',
            flip = false;

        if (hour == 12) hour = 0;
        hour += 3;
        if (hour >= 12) flip = true;
        if (hour > 12) hour -= 12;
        if (flip) ampm = ampm == 'am' ? 'pm' : 'am';

        entry = entry.replace(m, `${hour}:${minutes} ${ampm}${space}${zone}`);
      });

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

    this.fetchData(opts, target, (body, statusCode) => {
      if (statusCode == 404) return this.onError(target, '404');
      const payload = JSON.parse(body);

      this.send(target, payload.statuses[0].entities.media[0].media_url);
    });
  }

  Sign(target) {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${target.what.toLowerCase()}-daily-horoscope/`;

    this.fetchData(url, target, (body, statusCode) => {
      if (statusCode == 404) return this.onError(target, '404');
      const summ = Parser.parse(body).querySelector('.horoscope_summary'),
            elem = summ.querySelector('div'),
            ul = elem.querySelector('ul');

      if (ul) ul.set_content('');

      const entry = elem.structuredText.replace(/\n/g, '\n\n');

      this.send(target, `**${target.what}:**\n\n${entry}\n\n${host}`);
    });
  }

  fetchData(url, target, onEnd) {
    const source = url.hostname ? `http://${url.hostname}${url.path}` : url;
    this.logger.info(`Fetching ${target.what} from ${source}`);
    Https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => { onEnd(body, res.statusCode); });
      res.on('error', (err) => { this.onError(target, err) });
    }).end();
  }

  send(target, data) {
    this.logger.info(`Sending ${target.forLog()}`);
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
};
