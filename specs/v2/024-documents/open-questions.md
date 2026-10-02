# Questions ouvertes — gestion documentaire (024)

Valeur par défaut appliquée tant que la question n'est pas tranchée. Les décisions du propriétaire du produit (`specs/v2/DECISIONS-METIER.md`) l'emportent.

| ID | Question | Valeur appliquée | Qui tranche |
|---|---|---|---|
| Q-01 | **Rôles système** : quels rôles reçoivent quels niveaux de lecture ? | `documents.read` : personnel de l'établissement ; `read.restricted` : direction des études, secrétariat, économat ; `read.confidential` et `manage` : direction (`*`). Modification du module **rbac** (appliquée car la suite complète l'exige). À valider par le propriétaire rbac. | propriétaire du module rbac / direction |
| Q-02 | **Niveaux par nature** : l'économat voit-il les pièces d'identité des élèves (niveau RESTRICTED commun) ? faut-il un niveau financier distinct ? | Un seul échelon RESTRICTED ; une catégorie financière peut être restreinte à une personne par les **droits de catégorie** (`category_grants`) plutôt que par un niveau. | propriétaire du produit |
| Q-03 | **Rétention légale** des pièces d'élèves et du personnel (durée, anonymisation à l'archivage d'un dossier). | 365 jours après archivage (paramétrable par établissement et par catégorie, `0` = jamais) ; aucune purge automatique d'un document non archivé. | juridique / propriétaire du produit |
| Q-04 | **Taille maximale** par défaut. | 15 Mio par fichier (paramétrable par établissement, plafond plateforme 50 Mio). | exploitation |
| Q-05 | **Quotas** par plan (base, étendu, large). | 2 Gio / 20 Gio / 100 Gio (variables `DOCUMENTS_QUOTA_*`) ; features `documents.storage.extended` / `.large` à rattacher aux plans dans la console. | produit / commercial |
| Q-06 | **Antivirus** : ClamAV obligatoire en production ? | Optionnel : sans scanner configuré, les fichiers sont marqués `UNSCANNED` et un avertissement est journalisé au démarrage ; avec scanner, **fail-closed** en production (`DOCUMENTS_SCAN_FAIL_CLOSED=false` pour relâcher). Pas de nouvelle analyse périodique des fichiers existants. | sécurité / exploitation |
| Q-07 | **Prévisualisation des documents Office** (conversion PDF). | Désactivée (`DOCUMENTS_OFFICE_CONVERTER=off`) ; adaptateur LibreOffice fourni, à n'activer que dans un conteneur isolé sans réseau. Les fichiers Office restent téléchargeables. | sécurité / exploitation |
| Q-08 | **Origine dédiée** pour la prévisualisation (domaine sans cookie) afin d'isoler totalement un PDF malveillant du reste de l'application. | La prévisualisation passe par l'API (octets + en-têtes restrictifs) affichés via un objet blob ; une origine séparée est recommandée à terme. | sécurité |
| Q-09 | **Formats acceptés** : archives (zip), vidéo, audio, SVG, Office avec macros, Office 97 (OLE). | Refusés : archives, médias, SVG, macros. Office 97 (doc, xls, ppt) accepté sur en-tête OLE + extension (la cohérence interne n'est pas analysée). | sécurité |
| Q-10 | **Dépôt par un parent ou un élève** : un document déposé doit-il être validé par le secrétariat avant d'être « officiel » ? | Pas de circuit de validation : le dépôt est visible du personnel autorisé, tracé, et le secrétariat peut l'archiver. Un état « à valider » est une évolution. | propriétaire du produit |
| Q-11 | **Dédoublonnage** : refuser un doublon (même contenu, même catégorie, même propriétaire) ou l'accepter ? | Refus `409 documents.duplicate`, limité aux documents visibles de l'acteur. | propriétaire du produit |
| Q-12 | **Migration des pièces existantes** de `people`, `attendance`, `messaging` vers `documents`. | Non réalisée (voir `parity.md` §3) : adaptateur d'analyse seulement. | planification des modules concernés |
| Q-13 | **Expiration** : qui reçoit l'alerte ? | Le déposant, le propriétaire et la gestion : décision du chantier notifications (l'événement porte `createdBy`, `ownerType`, `ownerId`). | chantier notifications |
| Q-14 | **Recherche dans le contenu** (OCR, texte des PDF). | Hors V1 : métadonnées, titre, nom de fichier, étiquettes. | produit |
| Q-15 | **Partage à un parent ou un élève précis** (hors tutelle). | Partage à toute **identité** du tenant, y compris tuteur ou élève (identité IAM) ; l'écran propose en un clic les tuteurs de l'élève concerné. | propriétaire du produit |
| Q-16 | **Re-scan** des fichiers existants à la mise à jour des signatures. | Non prévu. | sécurité |
| Q-17 | **Changement de catégorie** d'un document vers un autre type. | Refusé (même type uniquement) pour ne pas modifier le sens du propriétaire. | propriétaire du produit |
