/**
 * Stub vide substitué à `fs` côté navigateur par Turbopack (voir
 * `next.config.js`, `experimental.turbo.resolveAlias`).
 *
 * Pendant de `config.resolve.fallback = { fs: false }` du bloc webpack, que
 * Turbopack n'applique pas : `exceljs/dist/es5/exceljs.browser.js` importe
 * `@fast-csv/format`, qui fait `require("fs")` au chargement même quand
 * l'export CSV n'est jamais utilisé. Le code qui s'en sert est mort dans le
 * navigateur, un objet vide suffit donc à satisfaire la résolution.
 */
module.exports = {};
