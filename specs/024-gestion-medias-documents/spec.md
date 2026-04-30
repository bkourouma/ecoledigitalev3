# Feature Specification: Phase 4 - Gestion des Médias et Documents

**Feature Branch**: `024-gestion-medias-documents`  
**Created**: 2025-11-30  
**Status**: Draft  
**Input**: User description: "Phase 4 - Gestion des Médias et Documents: Système complet de gestion des médias avec upload sécurisé d'images, vidéos et documents, organisation et stockage optimisé, galeries d'images pour les activités, compression automatique des images, génération de PDF professionnels, export multi-formats (PDF, Word, Excel), impression optimisée, et gestion des quotas et limitations."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload Sécurisé de Médias pour Activités (Priority: P1)

Les formateurs RSO doivent pouvoir uploader des fichiers multimédias (images, vidéos, documents) pour enrichir leurs activités, avec validation automatique des types de fichiers, des tailles, et traitement automatique (compression d'images, génération de vignettes). L'upload doit être sécurisé, avec protection contre les fichiers malveillants, et doit respecter les quotas de stockage de l'utilisateur.

**Why this priority**: L'enrichissement des activités avec des médias (photos d'exercices, vidéos de formation, documents de référence) est essentiel pour créer des rapports complets et professionnels conformes au code ISPS. Sans cette fonctionnalité, les activités restent textuelles uniquement et manquent de preuves visuelles. L'upload sécurisé est la base de tout le système de gestion des médias.

**Independent Test**: Un formateur RSO crée une activité et accède à la section médias. Il sélectionne 5 images (JPG, PNG) depuis son ordinateur par drag & drop. Le système valide chaque fichier (type, taille), affiche une barre de progression pour chaque upload, et traite automatiquement les images (compression, génération de vignettes). Les images sont associées à l'activité et apparaissent dans la galerie. Si l'utilisateur dépasse son quota, le système affiche un message d'erreur clair avant l'upload.

**Acceptance Scenarios**:

1. **Given** un formateur RSO consulte une activité, **When** il accède à la section médias, **Then** il voit une zone de dépôt (drag & drop) et un bouton pour parcourir les fichiers, avec indication des formats acceptés et des limites de taille par type
2. **Given** un formateur sélectionne des fichiers à uploader, **When** il choisit des fichiers valides (images JPG/PNG/GIF/WEBP jusqu'à 10MB, vidéos MP4/WEBM jusqu'à 100MB, documents PDF/DOC/XLS jusqu'à 20MB), **Then** le système accepte les fichiers et démarre l'upload avec affichage de la progression pour chaque fichier
3. **Given** un formateur tente d'uploader un fichier avec un type non autorisé (ex: .exe, .php), **When** il sélectionne le fichier, **Then** le système rejette immédiatement le fichier avec un message d'erreur clair indiquant le type de fichier non autorisé
4. **Given** un formateur tente d'uploader un fichier dépassant la taille maximale, **When** il sélectionne le fichier, **Then** le système rejette le fichier avec un message indiquant la taille maximale autorisée pour ce type de fichier
5. **Given** un formateur upload des images, **When** les images sont uploadées, **Then** le système compresse automatiquement les images trop grandes (redimensionnement si > 2048px, compression qualité 85%), génère des vignettes (300x300px), et stocke les versions originales, optimisées et vignettes
6. **Given** un formateur upload une vidéo, **When** la vidéo est uploadée, **Then** le système extrait les métadonnées (durée, dimensions, codec), génère une vignette à la 1ère seconde, et stocke la vidéo avec sa vignette
7. **Given** un formateur upload des fichiers, **When** l'upload est en cours, **Then** le système vérifie en temps réel si l'ajout de ces fichiers dépasserait le quota de l'utilisateur, et bloque l'upload avec un message clair si le quota serait dépassé
8. **Given** un formateur upload plusieurs fichiers simultanément (jusqu'à 10), **When** les uploads sont en cours, **Then** chaque fichier a sa propre barre de progression, et les uploads se font en parallèle sans bloquer l'interface
9. **Given** un formateur upload un fichier, **When** l'upload échoue (erreur réseau, serveur), **Then** le système affiche un message d'erreur spécifique, permet de réessayer l'upload du fichier échoué, et ne supprime pas les fichiers déjà uploadés avec succès

---

### User Story 2 - Bibliothèque de Médias et Organisation (Priority: P1)

Les formateurs RSO doivent pouvoir consulter, organiser et gérer tous leurs médias uploadés dans une bibliothèque centralisée. Ils doivent pouvoir filtrer par type, par activité, par période, rechercher par nom, prévisualiser les médias, modifier les légendes, réorganiser l'ordre, et supprimer des médias. La bibliothèque doit afficher les quotas d'utilisation et les statistiques.

**Why this priority**: Avec le temps, les formateurs accumulent de nombreux médias. Ils doivent pouvoir retrouver rapidement un média spécifique, voir leur utilisation de stockage, et gérer efficacement leur bibliothèque. Sans cette fonctionnalité, les médias deviennent inorganisés et difficiles à retrouver, réduisant leur utilité.

**Independent Test**: Un formateur RSO accède à la bibliothèque de médias. Il voit un tableau de bord avec son quota (456 MB / 1000 MB utilisé, 45.6%), la répartition par type (images: 234 MB, vidéos: 198 MB, documents: 24 MB), et la liste de tous ses médias en vue grille ou liste. Il filtre par type "images" et par activité "Entraînement évacuation T1 2024", et la liste se met à jour. Il clique sur une image pour la prévisualiser, modifie sa légende, change son ordre, puis supprime un média inutile. Le quota se met à jour automatiquement après suppression.

**Acceptance Scenarios**:

1. **Given** un formateur RSO accède à la bibliothèque de médias, **When** la page se charge, **Then** il voit un tableau de bord avec son quota total (utilisé / total avec pourcentage), la répartition par type de média (images, vidéos, documents) avec tailles et nombres de fichiers, et la liste de tous ses médias
2. **Given** un formateur consulte la bibliothèque, **When** il applique des filtres (type de média, activité associée, période de date), **Then** la liste se met à jour pour afficher uniquement les médias correspondants, et les filtres sont persistants dans l'URL pour permettre le partage
3. **Given** un formateur effectue une recherche par nom de fichier, **When** il saisit un terme de recherche, **Then** le système recherche dans les noms de fichiers originaux et les légendes, et affiche les résultats avec le terme mis en surbrillance
4. **Given** un formateur consulte la liste des médias, **When** il choisit la vue grille, **Then** les médias sont affichés en grille avec vignettes (images et vidéos), icônes pour documents, et informations clés (nom, taille, date) au survol
5. **Given** un formateur consulte la liste des médias, **When** il choisit la vue liste, **Then** les médias sont affichés en liste avec toutes les informations (type, nom, taille, activité associée, date d'upload, uploader) dans un tableau triable
6. **Given** un formateur clique sur un média pour le prévisualiser, **When** la modal de prévisualisation s'ouvre, **Then** il voit le média en grand (image/vidéo), les informations complètes (métadonnées, dimensions, taille, dates), la légende éditable, l'activité associée, et les actions disponibles (télécharger, modifier, supprimer, copier le lien)
7. **Given** un formateur modifie la légende d'un média, **When** il sauvegarde, **Then** la légende est mise à jour, et elle apparaît dans toutes les vues où le média est affiché (galerie d'activité, bibliothèque, exports)
8. **Given** un formateur réorganise l'ordre des médias d'une activité (par drag & drop ou flèches), **When** il sauvegarde, **Then** l'ordre est enregistré et préservé dans la galerie de l'activité et dans les exports
9. **Given** un formateur supprime un média, **When** il confirme la suppression, **Then** le média est marqué comme supprimé (soft delete), disparaît de la bibliothèque principale, le quota est mis à jour, mais le fichier physique est conservé pendant 30 jours avant suppression définitive
10. **Given** un formateur consulte son quota, **When** il approche de la limite (ex: > 80%), **Then** le système affiche un avertissement visuel et suggère de supprimer des médias inutilisés ou de contacter l'administrateur pour augmenter le quota

---

### User Story 3 - Galeries d'Images pour Activités (Priority: P1)

Les formateurs RSO doivent pouvoir créer et gérer des galeries d'images pour leurs activités, avec sélection multiple d'images depuis la bibliothèque ou upload direct, organisation par ordre, légendes individuelles, et désignation d'une image principale. Les galeries doivent s'afficher de manière professionnelle dans les activités et dans les exports.

**Why this priority**: Les activités de sûreté nécessitent souvent plusieurs photos pour documenter visuellement les exercices, formations, ou audits. Les galeries permettent d'organiser ces photos de manière cohérente et professionnelle, avec une image principale qui représente l'activité. C'est essentiel pour créer des rapports complets et visuellement riches.

**Independent Test**: Un formateur RSO consulte une activité d'entraînement. Il accède à la section galerie et clique sur "Ajouter des images". Il sélectionne 8 images depuis sa bibliothèque (par filtres et recherche) et upload 2 nouvelles images. Les 10 images apparaissent dans la galerie avec possibilité de réorganiser par drag & drop. Il définit une image comme principale (elle apparaît en premier et comme vignette de l'activité). Il ajoute des légendes à chaque image. La galerie s'affiche dans l'activité en grille responsive (2-4 colonnes selon la taille d'écran), et toutes les images sont incluses dans l'export PDF.

**Acceptance Scenarios**:

1. **Given** un formateur RSO consulte une activité, **When** il accède à la section galerie d'images, **Then** il voit la liste des images déjà associées (si présentes) et un bouton "Ajouter des images" pour enrichir la galerie
2. **Given** un formateur ajoute des images à une galerie, **When** il clique sur "Ajouter des images", **Then** il peut soit sélectionner des images depuis sa bibliothèque (avec recherche et filtres), soit uploader de nouvelles images directement, et sélectionner plusieurs images à la fois
3. **Given** un formateur a ajouté des images à une galerie, **When** les images sont ajoutées, **Then** elles apparaissent dans la galerie avec possibilité de réorganiser l'ordre par drag & drop, et chaque image peut avoir une légende individuelle
4. **Given** un formateur organise une galerie, **When** il définit une image comme principale, **Then** cette image apparaît en premier dans la galerie, est utilisée comme vignette de l'activité dans les listes, et est mise en avant dans les exports
5. **Given** un formateur consulte une activité avec galerie, **When** la page de l'activité s'affiche, **Then** la galerie s'affiche en grille responsive (2 colonnes sur mobile, 3 sur tablette, 4 sur desktop) avec toutes les images, leurs légendes, et possibilité de cliquer pour voir en grand
6. **Given** un formateur supprime une image d'une galerie, **When** il confirme, **Then** l'image est retirée de la galerie mais reste dans la bibliothèque (pas supprimée définitivement), et si c'était l'image principale, la première image restante devient principale
7. **Given** un formateur consulte une galerie, **When** il clique sur une image, **Then** une lightbox s'ouvre avec l'image en grand, navigation entre images (flèches gauche/droite), et affichage de la légende complète
8. **Given** une activité a une galerie d'images, **When** le formateur exporte l'activité en PDF, **Then** toutes les images de la galerie sont incluses dans le PDF avec leurs légendes, organisées en grille professionnelle sur plusieurs pages si nécessaire

---

### User Story 4 - Génération de PDF Professionnels (Priority: P1)

Les formateurs RSO et agents PFSO doivent pouvoir générer des PDF professionnels des activités avec mise en page soignée, logo de l'organisation, en-têtes et pieds de page, numérotation des pages, inclusion de toutes les images et galeries, tableaux formatés, recommandations, et options de personnalisation (format de page, orientation, filigrane optionnel).

**Why this priority**: Les PDF sont le format standard pour l'archivage et le partage officiel des rapports d'activités de sûreté. Les formateurs et agents doivent pouvoir générer des documents professionnels, prêts pour impression ou transmission aux autorités portuaires. Un PDF de qualité reflète la professionnalisme de l'organisation et facilite la conformité ISPS.

**Independent Test**: Un formateur RSO consulte une activité complète avec contenu riche, 12 images en galerie, 3 recommandations, et plusieurs tableaux. Il clique sur "Exporter en PDF". Le système génère un PDF professionnel avec page de couverture (logo, titre, métadonnées), contenu formaté avec tous les éléments (texte, tableaux, images avec légendes), galerie d'images sur pages dédiées, section recommandations, en-têtes avec code d'activité, pieds de page avec numérotation, et page finale avec mentions légales. Le PDF est téléchargé en moins de 5 secondes et s'ouvre correctement dans Adobe Reader.

**Acceptance Scenarios**:

1. **Given** un utilisateur autorisé consulte une activité, **When** il clique sur "Exporter en PDF", **Then** le système génère un PDF professionnel avec toutes les informations de l'activité et le télécharge automatiquement, ou affiche un formulaire d'options d'export si des personnalisations sont disponibles
2. **Given** un utilisateur génère un PDF avec options, **When** il sélectionne les options (format A4/Letter, orientation portrait/paysage, inclure images oui/non, inclure recommandations oui/non, filigrane oui/non), **Then** le PDF est généré selon ces options et téléchargé
3. **Given** un PDF est généré, **When** le document est créé, **Then** il contient une page de couverture avec logo de l'organisation, titre de l'activité, type d'activité, installation, date, et métadonnées clés
4. **Given** un PDF contient du contenu, **When** le document est généré, **Then** le contenu HTML de l'activité est converti en PDF avec préservation de la mise en forme (titres, paragraphes, listes, tableaux avec bordures et couleurs), et les images sont incluses avec leurs légendes
5. **Given** une activité a une galerie d'images, **When** le PDF est généré avec option "inclure images", **Then** toutes les images de la galerie sont incluses dans le PDF, organisées en grille professionnelle (2 images par page), avec légendes, et réparties sur plusieurs pages si nécessaire
6. **Given** une activité a des recommandations, **When** le PDF est généré avec option "inclure recommandations", **Then** une section dédiée aux recommandations est ajoutée avec toutes les recommandations, leurs priorités (avec codes couleur), statuts, et échéances
7. **Given** un PDF est généré, **When** le document est créé, **Then** chaque page a un en-tête avec le code d'activité et le titre (tronqué si trop long), et un pied de page avec numérotation "Page X sur Y", nom de l'organisation, et mention "Document confidentiel"
8. **Given** un utilisateur génère un PDF avec filigrane, **When** le PDF est créé, **Then** un filigrane "CONFIDENTIEL" apparaît en transparence sur chaque page en diagonale
9. **Given** un PDF est généré, **When** le téléchargement démarre, **Then** le nom du fichier suit le format "RAPPORT_[CODE_ACTIVITE]_[DATE].pdf" (ex: "RAPPORT_ACT-2024-PAD_COM-ENT-T1-001_2024-11-15.pdf")
10. **Given** un utilisateur génère un PDF, **When** la génération est en cours, **Then** un indicateur de progression s'affiche, et si la génération prend plus de 10 secondes, le système peut proposer de recevoir le PDF par email une fois prêt

---

### User Story 5 - Export Multi-formats (Word, Excel) (Priority: P2)

Les formateurs RSO doivent pouvoir exporter les activités en formats Word (DOCX) et Excel (XLSX) en plus du PDF, pour permettre l'édition ultérieure, l'intégration dans d'autres documents, ou l'analyse de données. Les exports doivent préserver la structure et le formatage dans la mesure du possible.

**Why this priority**: Certains utilisateurs préfèrent travailler avec Word ou Excel pour des raisons de compatibilité avec leurs outils existants, pour l'édition collaborative, ou pour l'analyse de données. Offrir plusieurs formats augmente la flexibilité et l'adoption du système. Cependant, c'est moins critique que le PDF qui est le format standard d'archivage.

**Independent Test**: Un formateur RSO consulte une activité avec contenu riche et tableaux de données. Il exporte en Word (DOCX). Le fichier s'ouvre dans Microsoft Word avec le contenu formaté (titres, paragraphes, tableaux préservés), les images incluses, et une structure claire. Il exporte ensuite une liste d'activités en Excel. Le fichier contient un tableau avec toutes les activités, colonnes pour chaque champ (code, titre, type, date, installation, statut), et peut être utilisé pour analyse ou reporting externe.

**Acceptance Scenarios**:

1. **Given** un formateur RSO consulte une activité, **When** il accède aux options d'export, **Then** il voit les options "Exporter en PDF", "Exporter en Word (DOCX)", et "Exporter en Excel (XLSX)" pour les listes d'activités
2. **Given** un formateur exporte une activité en Word, **When** le fichier DOCX est généré, **Then** le contenu est converti en format Word avec préservation de la structure (titres H1-H4, paragraphes, listes à puces/numérotées), les tableaux sont préservés avec formatage, et les images sont incluses avec leurs légendes
3. **Given** un formateur exporte une activité en Word, **When** il ouvre le fichier dans Microsoft Word ou LibreOffice, **Then** le document s'affiche correctement avec tous les éléments, et peut être édité normalement
4. **Given** un formateur exporte une liste d'activités en Excel, **When** le fichier XLSX est généré, **Then** il contient un tableau avec une ligne par activité, colonnes pour tous les champs pertinents (code, titre, type, sous-type, installation, date, durée, participants, statut), et peut être trié/filtré dans Excel
5. **Given** un formateur exporte en Excel avec filtres appliqués, **When** le fichier est généré, **Then** seules les activités correspondant aux filtres sont incluses dans l'export, et les filtres appliqués sont documentés dans une feuille séparée ou en en-tête
6. **Given** un utilisateur exporte en Word ou Excel, **When** le fichier est généré, **Then** le nom du fichier suit un format cohérent avec indication du format (ex: "ACTIVITE_ACT-2024-PAD_COM-ENT-T1-001.docx" ou "LISTE_ACTIVITES_2024.xlsx")

---

### User Story 6 - Gestion des Quotas et Limitations (Priority: P2)

Le système doit gérer les quotas de stockage par utilisateur, afficher l'utilisation en temps réel, avertir lorsque les limites approchent, et empêcher les uploads qui dépasseraient le quota. Les administrateurs doivent pouvoir ajuster les quotas par utilisateur. Le système doit permettre la consultation des statistiques d'utilisation.

**Why this priority**: Sans gestion de quotas, le stockage peut croître indéfiniment et devenir coûteux. Les quotas permettent de contrôler les coûts, d'encourager une utilisation raisonnable, et de planifier l'infrastructure. C'est important pour la viabilité à long terme du système, mais moins critique que les fonctionnalités de base d'upload et de gestion.

**Independent Test**: Un formateur RSO consulte son tableau de bord de médias. Il voit qu'il utilise 850 MB sur 1000 MB (85%). Il reçoit un avertissement visuel qu'il approche de la limite. Il tente d'uploader un fichier de 200 MB. Le système calcule que cela dépasserait le quota et bloque l'upload avec un message suggérant de supprimer des médias inutilisés ou de contacter l'administrateur. Un administrateur consulte les quotas de tous les utilisateurs, voit que ce formateur approche de la limite, et augmente son quota à 2000 MB. Le formateur peut maintenant uploader son fichier.

**Acceptance Scenarios**:

1. **Given** un utilisateur consulte son tableau de bord de médias, **When** la page se charge, **Then** il voit son quota total (utilisé / total en MB et pourcentage), une barre de progression visuelle, et la répartition par type de média (images, vidéos, documents) avec tailles et nombres de fichiers
2. **Given** un utilisateur approche de son quota (ex: > 80% utilisé), **When** il consulte son tableau de bord, **Then** le système affiche un avertissement visuel (couleur orange/rouge) et un message suggérant des actions (supprimer des médias inutilisés, contacter l'administrateur)
3. **Given** un utilisateur tente d'uploader des fichiers, **When** le système calcule la taille totale des fichiers à uploader, **Then** il vérifie si l'ajout dépasserait le quota, et si oui, bloque l'upload avant qu'il ne commence avec un message clair indiquant l'espace disponible et l'espace nécessaire
4. **Given** un utilisateur supprime des médias, **When** la suppression est confirmée, **Then** le quota est mis à jour immédiatement (diminution de l'espace utilisé), et l'utilisateur peut voir la libération d'espace dans le tableau de bord
5. **Given** un administrateur consulte la gestion des quotas, **When** il accède à la page d'administration, **Then** il voit la liste de tous les utilisateurs avec leurs quotas (total, utilisé, pourcentage), et peut filtrer/trier par utilisation
6. **Given** un administrateur modifie le quota d'un utilisateur, **When** il définit un nouveau quota total, **Then** le quota est mis à jour immédiatement, l'utilisateur reçoit une notification du changement, et le nouveau quota est visible dans le tableau de bord de l'utilisateur
7. **Given** un utilisateur consulte ses statistiques d'utilisation, **When** il accède à la section statistiques, **Then** il voit des graphiques et tableaux montrant l'évolution de l'utilisation dans le temps, la répartition par type de média, la taille moyenne des fichiers, et les activités les plus consommatrices d'espace
8. **Given** un utilisateur atteint 100% de son quota, **When** il tente d'uploader un fichier, **Then** le système bloque l'upload avec un message indiquant que le quota est atteint, et propose des actions (supprimer des médias, contacter l'administrateur pour augmentation de quota)

---

### User Story 7 - Impression Optimisée (Priority: P2)

Les utilisateurs doivent pouvoir imprimer les activités directement depuis le navigateur avec une mise en page optimisée pour l'impression : suppression des éléments de navigation, en-têtes et pieds de page appropriés, gestion des sauts de page, et préservation de la mise en forme.

**Why this priority**: L'impression directe depuis le navigateur est une fonctionnalité complémentaire à l'export PDF. Certains utilisateurs préfèrent imprimer directement sans générer de fichier intermédiaire. L'optimisation de la mise en page assure une impression professionnelle. C'est moins critique que l'export PDF mais améliore l'expérience utilisateur.

**Independent Test**: Un agent PFSO consulte une activité complète. Il clique sur "Imprimer". La boîte de dialogue d'impression du navigateur s'ouvre avec une prévisualisation optimisée. La page imprimée ne contient pas les éléments de navigation, a des en-têtes avec code d'activité, des pieds de page avec numérotation, et le contenu est formaté pour l'impression (couleurs adaptées, images optimisées, tableaux sur une seule page si possible). L'impression se fait correctement sur papier A4.

**Acceptance Scenarios**:

1. **Given** un utilisateur consulte une activité, **When** il clique sur "Imprimer", **Then** la boîte de dialogue d'impression du navigateur s'ouvre avec une prévisualisation optimisée pour l'impression
2. **Given** une page est préparée pour l'impression, **When** le mode impression est activé, **Then** tous les éléments de navigation (menus, boutons, barres latérales) sont masqués, et seuls le contenu de l'activité et les éléments essentiels sont visibles
3. **Given** une activité est imprimée, **When** la page est générée, **Then** chaque page a un en-tête avec le code d'activité et le titre (tronqué si nécessaire), et un pied de page avec numérotation "Page X sur Y" et nom de l'organisation
4. **Given** une activité contient des tableaux larges, **When** la page est imprimée, **Then** le système gère les sauts de page pour éviter de couper les tableaux au milieu, et ajuste la taille si nécessaire pour tenir sur une page
5. **Given** une activité contient des images, **When** la page est imprimée, **Then** les images sont optimisées pour l'impression (résolution adaptée, couleurs si imprimante couleur disponible), et les légendes sont préservées
6. **Given** un utilisateur imprime une activité, **When** il configure les options d'impression (orientation, marges, couleur/noir et blanc), **Then** la mise en page s'adapte aux options sélectionnées pour une impression optimale

---

### Edge Cases

- Que se passe-t-il si un utilisateur upload un fichier pendant que son quota est modifié par un administrateur ? (Le système doit vérifier le quota au moment de l'upload et utiliser la valeur la plus récente)
- Comment le système gère-t-il les fichiers corrompus ou partiellement uploadés ? (Le système doit détecter les uploads incomplets, nettoyer les fichiers partiels, et permettre la reprise de l'upload)
- Que se passe-t-il si un utilisateur supprime une activité qui contient des médias ? (Les médias doivent être marqués comme orphelins, conservés pendant 30 jours, puis supprimés automatiquement si non réassignés)
- Comment le système gère-t-il les noms de fichiers avec caractères spéciaux ou très longs ? (Le système doit normaliser les noms, remplacer les caractères problématiques, et tronquer si nécessaire tout en préservant l'unicité)
- Que se passe-t-il si la génération d'un PDF échoue pour une activité très volumineuse (>50 pages) ? (Le système doit gérer les timeouts, proposer une génération asynchrone, ou diviser en plusieurs PDF)
- Comment le système gère-t-il les images avec métadonnées EXIF très volumineuses ? (Le système doit extraire les métadonnées importantes, supprimer les données inutiles pour réduire la taille, et stocker séparément si nécessaire)
- Que se passe-t-il si un utilisateur upload une vidéo qui dépasse la limite mais qui est compressée automatiquement en dessous de la limite ? (Le système doit accepter la vidéo compressée si elle respecte la limite après traitement)
- Comment le système gère-t-il les exports PDF/Word pour des activités avec des centaines d'images ? (Le système doit gérer la mémoire, générer progressivement, ou proposer une version allégée)
- Que se passe-t-il si le stockage serveur est plein pendant un upload ? (Le système doit détecter l'erreur, informer l'administrateur, et bloquer les nouveaux uploads jusqu'à résolution)
- Comment le système gère-t-il les quotas pour les utilisateurs qui ont des activités partagées avec médias ? (Le quota doit être comptabilisé pour le propriétaire du média, pas pour les utilisateurs qui y ont accès)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow formateurs RSO to upload media files (images, videos, documents) to activities with validation of file types, sizes, and security checks
- **FR-002**: System MUST support drag & drop file upload with visual feedback and progress indicators for each file
- **FR-003**: System MUST validate uploaded files against allowed MIME types and file extensions before accepting them
- **FR-004**: System MUST enforce maximum file size limits: images up to 10 MB, videos up to 100 MB, documents up to 20 MB
- **FR-005**: System MUST automatically compress images that exceed optimal dimensions (resize if > 2048px width/height, compress to 85% quality) while preserving original files
- **FR-006**: System MUST automatically generate thumbnails (300x300px) for images and videos
- **FR-007**: System MUST extract and store video metadata (duration, dimensions, codec, bitrate) when videos are uploaded
- **FR-008**: System MUST generate video thumbnails at the 1-second mark when videos are uploaded
- **FR-009**: System MUST check user storage quota before allowing file uploads and block uploads that would exceed the quota
- **FR-010**: System MUST support uploading up to 10 files simultaneously with individual progress tracking for each file
- **FR-011**: System MUST provide a centralized media library where formateurs RSO can view, search, filter, and manage all their uploaded media
- **FR-012**: System MUST display storage quota usage (used / total in MB and percentage) with visual progress bar in the media library dashboard
- **FR-013**: System MUST allow filtering media by type (image, video, document), associated activity, and date range in the media library
- **FR-014**: System MUST provide full-text search in media library by original filename and captions
- **FR-015**: System MUST support both grid view (with thumbnails) and list view (tabular) for media library display
- **FR-016**: System MUST allow users to preview media in a modal with full details, editable captions, and available actions (download, edit, delete, copy link)
- **FR-017**: System MUST allow users to edit media captions and update them across all views where the media appears
- **FR-018**: System MUST allow users to reorder media within activity galleries using drag & drop or arrow controls
- **FR-019**: System MUST implement soft delete for media (mark as deleted, preserve file for 30 days, then permanent deletion)
- **FR-020**: System MUST update storage quota immediately when media is deleted
- **FR-021**: System MUST display quota warnings when usage exceeds 80% of total quota
- **FR-022**: System MUST allow formateurs RSO to create and manage image galleries for activities with multiple images, individual captions, and ordering
- **FR-023**: System MUST allow users to select images for galleries from existing media library or upload new images directly
- **FR-024**: System MUST allow users to designate a primary image for each activity gallery (displayed first, used as activity thumbnail)
- **FR-025**: System MUST display image galleries in responsive grid layout (2 columns mobile, 3 tablet, 4 desktop) within activities
- **FR-026**: System MUST provide lightbox functionality for viewing gallery images in full size with navigation between images
- **FR-027**: System MUST include all gallery images with captions in PDF exports of activities
- **FR-028**: System MUST allow formateurs RSO and PFSO agents to generate professional PDF documents from activities with customizable options
- **FR-029**: System MUST generate PDFs with cover page including organization logo, activity title, type, installation, date, and key metadata
- **FR-030**: System MUST convert activity HTML content to PDF with preservation of formatting (headings, paragraphs, lists, tables with borders and colors)
- **FR-031**: System MUST include images in PDF exports with captions, organized in professional grid layout (2 images per page) across multiple pages if needed
- **FR-032**: System MUST include recommendations section in PDF exports when option is selected, with priorities (color-coded), statuses, and due dates
- **FR-033**: System MUST add headers and footers to PDF pages: header with activity code and title, footer with page numbering "Page X of Y", organization name, and "Confidential document" notice
- **FR-034**: System MUST support optional watermark ("CONFIDENTIEL") on PDF pages when option is selected
- **FR-035**: System MUST generate PDF filenames in format "RAPPORT_[CODE_ACTIVITE]_[DATE].pdf"
- **FR-036**: System MUST display progress indicator during PDF generation for long operations
- **FR-037**: System MUST allow export of activities to Word (DOCX) format with preservation of structure (headings, paragraphs, lists, tables) and inclusion of images
- **FR-038**: System MUST ensure DOCX files open correctly in Microsoft Word and LibreOffice
- **FR-039**: System MUST allow export of activity lists to Excel (XLSX) format with one row per activity and columns for all relevant fields
- **FR-040**: System MUST respect applied filters when exporting activity lists to Excel
- **FR-041**: System MUST generate export filenames with format indicators (e.g., ".docx", ".xlsx") and consistent naming
- **FR-042**: System MUST manage storage quotas per user with configurable total limits (default 1000 MB)
- **FR-043**: System MUST display real-time quota usage (used / total in MB and percentage) with visual indicators
- **FR-044**: System MUST warn users when quota usage exceeds 80% of total
- **FR-045**: System MUST block file uploads that would exceed user quota with clear error messages
- **FR-046**: System MUST allow administrators to view quota usage for all users and adjust individual quotas
- **FR-047**: System MUST notify users when their quota is modified by an administrator
- **FR-048**: System MUST provide usage statistics (evolution over time, breakdown by media type, average file size, most space-consuming activities)
- **FR-049**: System MUST optimize print layout for activities by hiding navigation elements and adding appropriate headers and footers
- **FR-050**: System MUST handle page breaks in printed documents to avoid cutting tables or images in the middle
- **FR-051**: System MUST optimize images for printing (appropriate resolution, color handling)
- **FR-052**: System MUST store media files in organized directory structure (by year/month/type) for efficient management
- **FR-053**: System MUST preserve original uploaded files while storing optimized/compressed versions
- **FR-054**: System MUST extract and store EXIF metadata from images when available
- **FR-055**: System MUST log all media uploads, deletions, and quota changes for audit purposes
- **FR-056**: System MUST clean up orphaned media files (from deleted activities) after 30-day retention period
- **FR-057**: System MUST handle upload failures gracefully with retry options and preservation of successfully uploaded files

### Key Entities *(include if feature involves data)*

- **Activity Media**: Represents a media file (image, video, document, audio) attached to an activity. Key attributes: unique identifier, activity reference, media type (image/video/document/audio), original filename, stored filename, file path, thumbnail path (for videos/documents), file size in bytes, human-readable size, MIME type, file extension, dimensions (width, height for images/videos), duration in seconds (for videos/audio), caption, description, display order, primary image flag, processing status (in progress, processed, error), error message if processing failed, EXIF metadata (JSON for images), URLs (original, optimized, thumbnail), uploader reference, upload timestamp, update timestamp, soft delete timestamp. Relationships: belongs to one activity, uploaded by one user.

- **Document Export**: Represents a generated export document (PDF, Word, Excel, CSV) of an activity or activity list. Key attributes: unique identifier, activity reference (null if list export), user reference, export type (PDF, Word, Excel, CSV), filename, file path, file size in bytes, page format (A4, Letter, etc.), orientation (portrait, landscape), export options (JSON storing customization choices), generation status (in progress, completed, error), error message if generation failed, expiration timestamp (for auto-cleanup), download count, last download timestamp, creation timestamp. Relationships: optionally belongs to one activity, created by one user.

- **User Quota**: Represents storage quota and usage tracking for a user. Key attributes: unique identifier, user reference (one-to-one), total quota in MB (default 1000), used quota in MB (decimal precision), file size limits per type (image max MB, video max MB, document max MB), file counts (total files, images count, videos count, documents count), last upload timestamp, last cleanup timestamp, update timestamp. Relationships: belongs to one user (unique constraint).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Formateurs RSO can upload a single image file (up to 10 MB) and see it appear in the activity gallery within 10 seconds on standard broadband connection
- **SC-002**: System automatically compresses images exceeding optimal dimensions in under 2 seconds per image
- **SC-003**: Media library displays and filters correctly for users with up to 1000 media files in their library
- **SC-004**: Full-text search in media library returns relevant results in under 1 second for libraries with up to 1000 files
- **SC-005**: PDF generation completes in under 5 seconds for activities with up to 10 pages of content and 20 images
- **SC-006**: PDF generation completes in under 15 seconds for activities with up to 50 pages of content and 100 images
- **SC-007**: 95% of generated PDFs open correctly in Adobe Reader, Chrome PDF viewer, and other standard PDF readers
- **SC-008**: Word (DOCX) exports preserve document structure and formatting - 90% of users can successfully edit exported documents in Microsoft Word or LibreOffice
- **SC-009**: Excel (XLSX) exports contain accurate data - 100% of exported activity lists have correct field mappings and can be opened in Microsoft Excel or LibreOffice
- **SC-010**: Storage quota calculations are accurate - quota usage updates within 1 second of media upload or deletion
- **SC-011**: Quota warnings appear immediately when usage crosses 80% threshold
- **SC-012**: System prevents quota overruns - 100% of upload attempts that would exceed quota are blocked before file transfer begins
- **SC-013**: Image galleries display correctly in responsive layout across devices (mobile, tablet, desktop) with appropriate column counts
- **SC-014**: Print optimization works correctly - 95% of printed activities have proper page breaks, headers, and footers without cutting content inappropriately
- **SC-015**: Media processing (compression, thumbnail generation) succeeds for 98% of valid uploaded files
- **SC-016**: System handles concurrent uploads - up to 10 simultaneous file uploads complete successfully without blocking the interface
- **SC-017**: Orphaned media cleanup removes files after 30-day retention period with 100% accuracy (no false deletions of active media)
- **SC-018**: Users can find a specific media file in their library using search or filters in under 30 seconds for libraries with up to 500 files

## Out of Scope

- **Advanced Video Processing**: Video editing, trimming, format conversion, and advanced video metadata extraction are not included. Basic upload, thumbnail generation, and metadata extraction are included.
- **Media Versioning**: Version history for media files, rollback to previous versions, and version comparison are not included. Only current version is maintained.
- **CDN Integration**: Content Delivery Network (CDN) integration for media distribution, geographic replication, and advanced caching strategies are not included. Files are served from application server.
- **Advanced Image Editing**: In-browser image editing tools (crop, rotate, filters, annotations) are not included. Images are uploaded and displayed as-is (with automatic compression).
- **Media Sharing Between Users**: Direct sharing of media files between users, media libraries shared across teams, and collaborative media management are not included. Media belongs to the uploading user.
- **Bulk Media Operations**: Bulk upload via ZIP files, bulk deletion, bulk metadata editing, and bulk organization operations are not included. Operations are performed file-by-file.
- **Media Analytics**: Detailed analytics on media usage (views, downloads, popular media), media performance metrics, and usage trends are not included. Basic quota statistics are included.
- **Automated Media Tagging**: AI-powered automatic tagging, categorization, and content recognition for media files are not included. Manual captions and organization only.
- **Media Watermarking**: Automatic watermarking of images/videos with logos or text for copyright protection is not included. PDF watermarking for documents is included.
- **Advanced Export Formats**: Export to PowerPoint (PPTX), export to CSV for media lists, and custom export templates are not included. PDF, Word, and Excel exports are included.
- **Media Streaming**: Progressive video streaming, adaptive bitrate streaming, and video player with advanced controls are not included. Videos are downloadable and playable via standard HTML5 video player.
- **External Storage Integration**: Integration with cloud storage services (AWS S3, Google Cloud Storage, Azure Blob) for media storage is not included. Files are stored on application server filesystem.
- **Media Approval Workflow**: Approval workflow for media before publication, media moderation, and content review processes are not included. Media is immediately available after upload.

## Dependencies

- **Phase 3 - Activity Management**: The activity management system (Phase 3) must be fully implemented and functional. Media management extends activities with media files, so activities must exist first. The `rso_activites_medias` table structure from Phase 3 must be extended with additional fields for Phase 4 requirements.
- **Phase 1 - Authentication**: User authentication and role-based access control must be functional. Media uploads and management require authenticated users with appropriate permissions.
- **Phase 2 - Installations**: Installation management must be complete. Activities (and their media) are linked to installations.
- **File Storage System**: A file storage system must be available with sufficient capacity and proper directory structure. The system needs write access to upload directories.
- **Image Processing Library**: A library for image processing (compression, resizing, thumbnail generation, EXIF extraction) must be available or integrated.
- **Video Processing Tools**: Tools for video processing (thumbnail generation, metadata extraction) must be available on the server (e.g., FFmpeg).
- **PDF Generation Library**: A library or service for generating PDF documents from HTML/content must be available or integrated.
- **Office Document Generation Libraries**: Libraries for generating Word (DOCX) and Excel (XLSX) files must be available or integrated.
- **Database Schema Extensions**: Database migrations must extend the `rso_activites_medias` table from Phase 3 and add new tables for exports and quotas.

## Assumptions

- Users have modern web browsers (Chrome, Firefox, Safari, Edge) with JavaScript enabled and support for drag & drop file uploads
- Internet connection is available during media uploads (no offline upload support)
- Server has sufficient storage capacity for media files (scalable storage solution recommended for production)
- Image files uploaded will typically be photos from training sessions, exercises, or audits, with file sizes ranging from 100KB to 10MB before compression
- Video files will typically be short training videos or exercise recordings, with file sizes up to 100MB
- Document files will typically be PDF reports, Word documents, or Excel spreadsheets, with file sizes up to 20MB
- Users will primarily upload media in French language context, but filenames and content may contain special characters (UTF-8 support required)
- The system will handle up to 1000 media files per user without significant performance degradation
- Media files will be accessed more frequently for viewing than for editing (read-heavy workload)
- Administrators will occasionally need to manage quotas and review storage usage across all users
- The server environment supports image and video processing tools (sufficient CPU and memory for processing operations)
- Generated PDFs and exports will primarily be used for archiving, printing, and sharing with port authorities and compliance organizations

