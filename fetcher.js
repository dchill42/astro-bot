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
    let retried = false;
    const locale = 'en-US',
          date = new Date(),
          weekday = date.toLocaleString(locale, { weekday: 'long' }),
          month = date.toLocaleString(locale, { month: 'long' }),
          day = date.getDate(),
          url = `https://skywatchastrology.com/${weekday.toLowerCase()}-${month.toLowerCase()}-${day}-2/`,
          skywatchResult = (body, statusCode) => {
            if (statusCode == 404 && weekday.toLowerCase() == 'saturday' && !retried) {
              retried = true;
              this.logger.info(`Retrying weekend ${target.what}`);
              const weurl = `https://skywatchastrology.com/the-weekend-${month.toLowerCase()}-${day}-${day + 1}/`;
              this.fetchData(weurl, target, skywatchResult);
              return;
            }

            const elem = Parser.parse(body).querySelector('.entry-content'),
                  entry = elem.structuredText.replace(/\n/g, '\n\n');

            this.send(target, `**${weekday}, ${month} ${day}**\n\n${entry}\n\nhttps://skywatchastrology.com`);
          };

    this.fetchData(url, target, skywatchResult);
  }

  AstrologyAnswers(target) {
    const query = '(%23dailyreading)%20(from%3AAstrologyAnswer)',
          args = `q=${query}&result_type=recent&count=1&include_entities=1&tweet_mode=extended`,
          opts = {
            hostname: 'api.twitter.com',
            path: `/1.1/search/tweets.json?${args}`,
            headers: { Authorization: `Bearer ${Auth.twitter}` }
          };

    this.fetchData(opts, target, (body) => {
      const payload = JSON.parse(body);

      this.send(target, payload.statuses[0].entities.media[0].media_url);
    });
  }

  Sign(target) {
    const host = 'https://astrologyanswers.com/horoscopes',
          url = `${host}/${target.what.toLowerCase()}-daily-horoscope/`;

    this.fetchData(url, target, (body) => {
      const summ = Parser.parse(body).querySelector('.horoscope_summary'),
            elem = summ.querySelector('div'),
            ul = elem.querySelector('ul');

      if (ul) ul.set_content('');

      const entry = elem.structuredText.replace(/\n/g, '\n\n');

      this.send(target, `${entry}\n\n${host}`);
    });
  }

  fetchData(url, target, onEnd) {
    this.logger.info(`Fetching ${target.what}`);
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
