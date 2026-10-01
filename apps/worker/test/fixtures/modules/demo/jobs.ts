import { defineScheduledJob } from "../../../../src/sdk";

export default [
  defineScheduledJob({
    name: "demo-job",
    cron: "0 0 1 1 *",
    handler: async ({ logger }) => {
      logger.info({}, "demo-job exécuté");
    },
  }),
];
