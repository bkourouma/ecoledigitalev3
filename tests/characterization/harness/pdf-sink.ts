/**
 * Puits des « documents de bulletin » que la route classique passe au générateur PDF.
 *
 * Le calcul du bulletin classique vit dans le handler `POST /report-cards/pdf` ; son résultat (une liste de
 * `ReportCardDocumentInput`) n'est pas renvoyé au client mais remis à Puppeteer. Le test remplace UNIQUEMENT ce
 * dernier maillon (rendu HTML -> PDF, hors périmètre) par une fonction qui range l'entrée ici, et exécute tout le
 * reste de la route pour de vrai (SQL, classements, moyennes, mentions, décisions).
 */
export const pdfSink: { reportCards: unknown[][] } = { reportCards: [] };
