import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
  applyRlsContextToClient,
  enterRlsRequestContext,
} from "../services/rls-context.service";

type PgClientLike = {
  query: (...args: any[]) => any;
  release: () => void;
};

type PgPoolLike = {
  connect: (...args: any[]) => Promise<PgClientLike>;
  query: (...args: any[]) => any;
  __rlsContextPatched?: boolean;
};

async function rlsContextPlugin(fastify: FastifyInstance) {
  const pg = fastify.pg as PgPoolLike | undefined;

  if (!pg || pg.__rlsContextPatched) {
    return;
  }

  const originalConnect = pg.connect.bind(pg);

  pg.connect = async (...args: any[]) => {
    const client = await originalConnect(...args);

    try {
      await applyRlsContextToClient(client);
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  };

  pg.query = (...args: any[]) => {
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : undefined;

    if (callback) {
      pg.connect()
        .then((client) => {
          client.query(...args, (error: unknown, result: unknown) => {
            client.release();
            callback(error, result);
          });
        })
        .catch((error) => callback(error));
      return undefined;
    }

    return (async () => {
      const client = await pg.connect();
      try {
        return await client.query(...args);
      } finally {
        client.release();
      }
    })();
  };

  pg.__rlsContextPatched = true;

  fastify.addHook("onRequest", async () => {
    enterRlsRequestContext();
  });
}

export default fp(rlsContextPlugin, {
  name: "rls-context",
});
