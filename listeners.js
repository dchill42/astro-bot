const Fs = require('fs');

const { LIST_DIR } = require('./constants');

module.exports = class Listeners {
  constructor(logger, cache) {
    this.logger = logger;
    this.cache = cache;
    this.listeners = {};
    this.load();
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
};
