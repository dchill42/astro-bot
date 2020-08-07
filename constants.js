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

module.exports = {
  SCHED_DIR,
  LIST_DIR,
  LOG_FILE,
  MS_PER_MIN,
  MS_PER_HOUR,
  SIGNS
}
