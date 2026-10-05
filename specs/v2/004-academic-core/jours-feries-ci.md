# Jours fériés de Côte d'Ivoire — liste à confirmer (décision O-10)

Réponse du client (2026-10-05) : « le calendrier national (jours fériés ivoiriens) est **préchargé par la plateforme** ».
Ce fichier consigne ce qui est livré, ce qui est volontairement **absent**, et ce que le client doit **confirmer** avant de
retirer l'état « à confirmer ». Aucune date n'a été inventée : toute ligne livrée est `source_kind = placeholder`,
`needs_confirmation = true` (voir migration `0711_academic_national_holidays.sql`).

## Livré (date fixe, date calendaire certaine) — à confirmer par le texte en vigueur

| Code | Jour férié | Date |
|---|---|---|
| `NEW_YEAR` | Jour de l'An | 1er janvier |
| `LABOUR_DAY` | Fête du Travail | 1er mai |
| `INDEPENDENCE_DAY` | Fête de l'Indépendance | 7 août |
| `ASSUMPTION` | Assomption | 15 août |
| `ALL_SAINTS` | Toussaint | 1er novembre |
| `CHRISTMAS` | Noël | 25 décembre |

## Livré comme DÉFINITION SANS DATE (fêtes mobiles — l'établissement saisit les dates chaque année)

| Code | Fête | Pourquoi sans date |
|---|---|---|
| `EASTER_MONDAY` | Lundi de Pâques | calculé chaque année (calendrier liturgique) |
| `ASCENSION` | Ascension | dépend de Pâques |
| `WHIT_MONDAY` | Lundi de Pentecôte | dépend de Pâques |
| `EID_AL_FITR` | Aïd el-Fitr (fin du Ramadan) | calendrier lunaire, annoncé chaque année |
| `EID_AL_ADHA` | Aïd el-Adha (Tabaski) | calendrier lunaire, annoncé chaque année |
| `MAWLID` | Mawlid (Maouloud) | calendrier lunaire, annoncé chaque année |

La plateforme **ne calcule aucune** de ces dates : l'établissement les ajoute dans son calendrier (`/v2/academic/settings`,
onglet Calendrier). Le client peut demander plus tard un calcul de Pâques (algorithme public) ou une publication annuelle
par la console de la plateforme.

## Volontairement NON livré (incertain) — à trancher par le client

| Jour | Doute |
|---|---|
| 15 novembre — Journée nationale de la Paix | La date est communément citée mais le texte exact n'a pas été vérifié. |
| 7 décembre — commémoration du Président Houphouët-Boigny | Statut actuel de jour férié incertain (a été férié puis modifié). |
| Nuit du Destin (Laylat al-Qadr) | Statut de jour férié non vérifié. |
| Jours exceptionnels décrétés par le gouvernement (ponts, deuils, scrutins) | Par nature non prévisibles : l'établissement les ajoute. |

## Pour passer une ligne de « à confirmer » à « confirmée »

La console de la plateforme (acteur `system`) met à jour la ligne : `source_kind = 'regulation'`, `source_reference = <texte
officiel>` et `needs_confirmation = false`. La base refuse une ligne « confirmée » sans référence.
