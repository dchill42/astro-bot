const Discord = require('discord.io');
const Logger = require('winston');
const Auth = require('./auth.json');

Logger.remove(Logger.transports.Console);
Logger.add(new Logger.transports.Console,  { colorize: true });
Logger.level = 'debug';

const Astro = new Discord.Client({ token: auth.token, autorun: true });
Astro.on('ready', function (e) {
  Logger.info('Connected');
  Logger.info(`User: ${Astro.username} (${Astro.id})`);
});
