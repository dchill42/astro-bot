module.exports = class Communicator {
  constructor(entity) {
    this.entity = entity;
  }

  get name() {
    if (this.isUser) return this.entity.username;
    if (this.isDm) return this.entity.recipient.username;
    return this.entity.name;
  }

  get id() {
    return this.entity.id;
  }

  get mention() {
    return this.entity.toString();
  }

  get code() {
    return this.isUser ? 'u' : 'c';
  }

  get preposition() {
    return this.isUser ? 'for' : 'in';
  }

  get isUser() {
    return this.entity.type === undefined;
  }

  get isDm() {
    return this.entity.type === 'dm';
  }

  static byId(id, isUser, cache) {
    if (!id) return null;
    const entity = isUser ? cache.users.get(id) : cache.channels.get(id);
    return new Communicator(entity, isUser);
  }
};
