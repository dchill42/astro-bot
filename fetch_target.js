const Communicator = require('./communicator');
const { SIGNS } = require('./constants');

module.exports = class FetchTarget {
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
    const lowhat = what.toLowerCase();
    if (lowhat.startsWith('sky')) return 'Skywatch';
    else if (lowhat == 'aa' || lowhat.startsWith('astro')) return 'AstrologyAnswers';
    return SIGNS[lowhat.slice(0, 3)];
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

  static fromString(jobName, cache) {
    const [_, what, guildId, code, id] = jobName.match(/^(\w+)@(\d+)#([uc])(\d+)/),
          isUser = code == 'u',
          recipient = Communicator.byId(id, isUser, cache);

    return new FetchTarget({ guildId, what, recipient });
  }
};