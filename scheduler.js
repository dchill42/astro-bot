const Fs = require('fs');
const Cron = require('node-schedule');

const FetchTime = require('./fetch_time');
const FetchTarget = require('./fetch_target');
const { SCHED_DIR } = require('./constants');

module.exports = class Scheduler {
  constructor(logger, cache, fetcher) {
    this.logger = logger;
    this.cache = cache;
    this.fetcher = fetcher;
    this.jobs = {};
    this.readJobs();
  }

  scheduleJob(target, when) {
    const jobName = target.toString(),
          guildJobs = this.jobsForGuild(target.guildId),
          job = guildJobs[jobName];

    if (job) job.schedule.cancel();
    guildJobs[jobName] = { time: when.ms }
    guildJobs[jobName].schedule = Cron.scheduleJob(when.cron, () => { this.runJob(jobName); });
    this.writeJobs(target.guildId);
  }

  cancelJob(target) {
    const jobName = target.toString(),
          guildJobs = this.jobsForGuild(target.guildId),
          job = guildJobs[jobName];

    if (!job) return false;
    job.schedule.cancel();
    delete guildJobs[jobName];
    this.writeJobs(target.guildId);
    return true;
  }

  runJob(jobName) {
    const target = FetchTarget.fromString(jobName, this.cache);

    this.logger.info(`Running ${target.forLog()}`);
    this.fetcher.dispatch(target);
  }

  listJobs(guildId) {
    const guildJobs = this.jobsForGuild(guildId);
    return Object.keys(guildJobs).map(k => { return this.jobString(k); }).join('\n');
  }

  jobString(jobName) {
    const target = FetchTarget.fromString(jobName, this.cache),
          ms = this.jobsForGuild(target.guildId)[jobName].time,
          when = new FetchTime({ ms });
    return `${target.inWords()} at ${when.gmt} GMT`;
  }

  readJobs() {
    Fs.readdir(SCHED_DIR, (err, files) => {
      if (err) return this.logger.error(err);

      files.forEach(f => {
        if (f.startsWith('.')) return;

        Fs.readFile(`${SCHED_DIR}/${f}`, (err, data) => {
          if (err) return this.logger.error(err);

          const guildJobs = this.jobsForGuild(f.slice(0, -5));

          Object.entries(JSON.parse(data)).map(([jobName, ms]) => {
            const when = new FetchTime({ ms });

            guildJobs[jobName] = { time: ms }
            guildJobs[jobName].schedule = Cron.scheduleJob(when.cron, () => { this.runJob(jobName); });
          });
        });
      });
    });
  }

  writeJobs(guildId) {
    const guildJobs = this.jobsForGuild(guildId),
          tree = Object.entries(guildJobs).map(([k, v]) => { return [k, v.time]; }),
          data = JSON.stringify(Object.fromEntries(tree));

    Fs.writeFile(`${SCHED_DIR}/${guildId}.json`, data, err => { if (err) this.logger.error(err); });
  }

  jobsForGuild(guildId) {
    return this.jobs[guildId] || (this.jobs[guildId] = {});
  }
};
