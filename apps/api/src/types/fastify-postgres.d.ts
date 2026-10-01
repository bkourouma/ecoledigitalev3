// Augmentation `fastify.pg` (@fastify/postgres) pour les programmes TypeScript qui ne chargent pas `src/index.ts`
// (tsconfig.v2.json : plateforme v2) mais importent des services legacy qui s'y appuient
// (`services/blacklist.service.ts`, via `platform/super-admin-authorizer.ts`).
import "@fastify/postgres";
