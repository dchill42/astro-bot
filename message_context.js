const Communicator = require('./communicator');

module.exports = class MessageContext {
  constructor(msg, myId, cache) {
    this.msg = msg;
    this.myId = myId;
    this.cache = cache;
    this.channelObj = null;
    this.authorObj = null;
  }

  get content() {
    return this.msg.content;
  }

  get channel() {
    return (this.channelObj = this.channelObj || new Communicator(this.msg.channel, false));
  }

  get author() {
    return (this.authorObj = this.authorObj || new Communicator(this.msg.author, true));
  }

  get myAvatar() {
    return this.msg.client.user.displayAvatarURL({ size: 64 });
  }

  get authorAvatar() {
    return this.msg.author.displayAvatarURL({ size: 64 });
  }

  get mentioned() {
    return (this.msg.mentions.users.find(u => { return u.id === this.myId }) ||
      this.msg.mentions.roles.find(r => { return r.id === this.myId }));
  }

  get fromAdmin() {
    return this.member.hasPermission('ADMINISTRATOR');
  }

  get isDm() {
    return this.msg.channel.type == 'dm';
  }

  get receivedDm() {
    return this.isDm && this.msg.author.id != this.myId;
  }

  get recipient() {
    const channel = this.msg.channel;
    if (!channel.type == 'dm') return channel;
    if (channel.client.user.id == this.myId) return channel.recipient;
    return channel.client.user;
  }

  get member() {
    if (this.msg.member) return this.msg.member;
    const guild = this.msg.channel.client.guilds.cache.get(this.guildId);
    return guild.members.cache.get(this.recipient.id);
  }

  get guildId() {
    if (this.msg.guild) return this.msg.guild.id;

    const channel = this.msg.channel,
          gids_a = channel.client.guilds.cache.map(g => g.id),
          gids_b = channel.recipient.client.guilds.cache.map(g => g.id);

    return gids_a.filter(g => gids_b.includes(g))[0];
  }

  react(emoji) {
    this.msg.react(emoji);
  }

  reply(message) {
    this.msg.channel.send(message);
  }

  direct(message) {
    this.msg.author.send(message);
  }

  inform(message) {
    if (!this.receivedDm) this.reply(message);
  }
};
