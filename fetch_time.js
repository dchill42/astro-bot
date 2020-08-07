const Offsets = require('timezone-abbr-offsets');

const { MS_PER_MIN, MS_PER_HOUR } = require('./constants');

module.exports = class FetchTime {
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
};
