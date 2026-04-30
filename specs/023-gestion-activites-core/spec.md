# Feature Specification: Phase 3 - Gestion des Activités (CORE)

**Feature Branch**: `023-gestion-activites-core`  
**Created**: 2025-11-30  
**Status**: Draft  
**Input**: User description: "Phase 3 - Gestion des Activités (CORE) - Système complet de gestion des activités RSO-PFSO avec éditeur de texte riche, workflow de création, permissions, recommandations, recherche et export"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Création d'Activité par Workflow Guidé (Priority: P1)

Les formateurs RSO doivent pouvoir créer des activités de sûreté (rapports, exercices, formations, audits, évaluations) en suivant un workflow guidé qui les amène étape par étape : sélection de l'année (déjà en session), sélection de l'installation, sélection du type d'activité hiérarchique (avec sous-types si applicable), puis rédaction du contenu dans un éditeur de texte riche professionnel.

**Why this priority**: La création d'activités est le cœur de métier de la plateforme. Sans cette fonctionnalité, les formateurs ne peuvent pas documenter leurs activités de sûreté conformes au code ISPS. Le workflow guidé assure la cohérence des données et évite les erreurs de saisie.

**Independent Test**: Un formateur RSO connecté peut accéder à la page de création d'activité, voir l'année sélectionnée (pré-remplie), sélectionner une installation dans la liste, choisir un type d'activité principal (ex: Entraînements), voir apparaître les sous-types (Trimestre 1, 2, 3, 4), sélectionner un sous-type, remplir les informations générales (titre, date, durée, lieu, participants), puis accéder à l'éditeur de texte riche pour rédiger le contenu complet de l'activité.

**Acceptance Scenarios**:

1. **Given** un formateur RSO est connecté avec une année sélectionnée en session, **When** il accède à la page de création d'activité, **Then** il voit l'année pré-remplie et non modifiable, un champ de sélection d'installation avec toutes les installations disponibles, et un champ de sélection de type d'activité avec la hiérarchie complète (types principaux et sous-types)
2. **Given** un formateur a sélectionné le type "Entraînements", **When** il choisit ce type, **Then** un champ de sous-type apparaît dynamiquement avec les options "Trimestre 1", "Trimestre 2", "Trimestre 3", "Trimestre 4", et la sélection d'un sous-type devient obligatoire
3. **Given** un formateur a sélectionné le type "Exercice Annuel", **When** il choisit ce type, **Then** un champ de sous-type apparaît avec les options "Séminaire", "Sur Table", "Grandeur Nature"
4. **Given** un formateur a sélectionné le type "Audit en Sûreté", **When** il choisit ce type, **Then** un champ de sous-type apparaît avec les options "Semestre 1", "Semestre 2"
5. **Given** un formateur a sélectionné un type sans sous-types (ex: Cartographie, Formation en Sûreté), **When** il choisit ce type, **Then** aucun champ de sous-type n'apparaît et il peut directement continuer
6. **Given** un formateur a rempli les informations générales (installation, type, sous-type si applicable, titre, date, durée, lieu, participants), **When** il valide le formulaire, **Then** le système génère automatiquement un code d'activité unique (format ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN), enregistre les informations, et redirige vers l'éditeur de texte riche
7. **Given** un formateur tente de créer une activité avec une date hors de l'année sélectionnée, **When** il valide, **Then** une erreur de validation apparaît indiquant que la date doit être dans l'année sélectionnée
8. **Given** un formateur a renseigné une plateforme de visioconférence, **When** il valide, **Then** le système exige que le lien de visioconférence soit également renseigné et valide (format URL)

---

### User Story 2 - Rédaction avec Éditeur de Texte Riche Professionnel (Priority: P1)

Les formateurs RSO doivent pouvoir rédiger le contenu complet de leurs activités dans un éditeur de texte riche qui permet la mise en forme avancée, l'insertion de tableaux complexes, d'images, de vidéos, de cartes géographiques, et la création de galeries d'images, avec sauvegarde automatique pour éviter les pertes de données.

**Why this priority**: Le contenu des activités est la documentation officielle de conformité ISPS. Les formateurs doivent pouvoir créer des rapports professionnels avec tous les éléments visuels nécessaires (tableaux de données, photos, cartes des installations, vidéos de formation). Sans un éditeur puissant, les rapports ne peuvent pas être complets et professionnels.

**Independent Test**: Un formateur RSO dans l'éditeur peut formater du texte (gras, italique, titres H1-H4), créer un tableau avec plusieurs lignes et colonnes, insérer une image depuis son ordinateur (qui est uploadée et affichée), insérer une vidéo YouTube par son URL (qui s'affiche en embed), insérer une carte Google Maps par adresse (qui s'affiche en iframe), créer une galerie d'images avec plusieurs photos, et sauvegarder le contenu. Le système sauvegarde automatiquement toutes les 30 secondes, et affiche un avertissement si le formateur tente de quitter avec des modifications non sauvegardées.

**Acceptance Scenarios**:

1. **Given** un formateur est dans l'éditeur de texte riche, **When** il rédige du texte et applique des formats (gras, italique, souligné, titres), **Then** le texte est formaté visuellement dans l'éditeur et le formatage est préservé lors de la sauvegarde
2. **Given** un formateur veut insérer un tableau, **When** il utilise l'outil de création de tableau, **Then** il peut spécifier le nombre de lignes et colonnes, créer le tableau, et modifier les propriétés (bordures, couleurs, largeur)
3. **Given** un formateur veut insérer une image, **When** il clique sur le bouton d'insertion d'image et sélectionne un fichier depuis son ordinateur, **Then** l'image est uploadée sur le serveur, un indicateur de progression s'affiche, et l'image est insérée dans l'éditeur à la position du curseur avec possibilité de redimensionnement
4. **Given** un formateur veut insérer une vidéo YouTube, **When** il colle l'URL de la vidéo YouTube dans l'outil d'insertion de média, **Then** la vidéo est insérée en embed et s'affiche correctement dans l'éditeur et dans la vue finale
5. **Given** un formateur veut insérer une carte Google Maps, **When** il utilise l'outil d'insertion de carte et saisit une adresse ou coordonnées, **Then** une prévisualisation de la carte s'affiche, il peut ajuster la largeur et hauteur, et la carte est insérée en iframe dans l'éditeur
6. **Given** un formateur veut créer une galerie d'images, **When** il utilise l'outil de galerie et upload plusieurs images (par drag & drop ou sélection), **Then** les images sont uploadées, une grille de prévisualisation s'affiche, il peut choisir le nombre de colonnes (2, 3, ou 4), et la galerie est insérée dans l'éditeur avec toutes les images
7. **Given** un formateur rédige dans l'éditeur, **When** il continue à travailler, **Then** le système sauvegarde automatiquement le contenu toutes les 30 secondes sans intervention, et affiche "Dernière sauvegarde : Il y a X minutes" en bas de l'éditeur
8. **Given** un formateur a des modifications non sauvegardées dans l'éditeur, **When** il tente de quitter la page ou fermer l'onglet, **Then** un avertissement du navigateur apparaît lui demandant de confirmer s'il veut vraiment quitter avec des modifications non sauvegardées
9. **Given** un formateur a rédigé du contenu dans l'éditeur, **When** il sauvegarde l'activité, **Then** le contenu HTML est enregistré, une version texte (sans balises HTML) est extraite et enregistrée pour la recherche full-text, et l'activité est marquée comme "brouillon" par défaut
10. **Given** un formateur a créé une activité en brouillon, **When** il revient plus tard sur cette activité, **Then** le contenu de l'éditeur est restauré depuis la dernière sauvegarde, y compris les images et médias insérés

---

### User Story 3 - Gestion des Permissions de Visualisation (Priority: P1)

Les formateurs RSO doivent pouvoir contrôler précisément quels agents PFSO peuvent consulter chaque activité : soit rendre l'activité visible à tous les agents PFSO de l'installation, soit sélectionner individuellement les agents PFSO autorisés. Les agents PFSO ne peuvent consulter que les activités pour lesquelles ils ont reçu une permission explicite ou qui sont marquées comme visibles par tous.

**Why this priority**: La confidentialité et le contrôle d'accès sont essentiels dans un contexte de sûreté portuaire. Certaines activités peuvent contenir des informations sensibles qui ne doivent être visibles qu'à certains agents PFSO. Le système doit permettre un contrôle granulaire tout en offrant une option de partage large pour les activités non sensibles.

**Independent Test**: Un formateur RSO crée une activité et, dans la section permissions, coche "Visible par tous les agents PFSO de cette installation". Il sauvegarde. Un agent PFSO de cette installation peut alors consulter l'activité. Le formateur modifie ensuite les permissions pour désélectionner "tous" et sélectionne individuellement 2 agents PFSO spécifiques. Seuls ces 2 agents peuvent maintenant consulter l'activité, les autres agents PFSO de la même installation ne la voient plus.

**Acceptance Scenarios**:

1. **Given** un formateur RSO crée ou modifie une activité, **When** il accède à la section "Permissions de visualisation", **Then** il voit une case à cocher "Visible par tous les agents PFSO de cette installation" et une liste de tous les agents PFSO de l'installation avec des cases à cocher individuelles
2. **Given** un formateur coche "Visible par tous les agents PFSO", **When** il sauvegarde, **Then** tous les agents PFSO de l'installation peuvent consulter l'activité, et cette permission est enregistrée dans la base de données
3. **Given** un formateur décoche "Visible par tous" et sélectionne individuellement des agents PFSO, **When** il sauvegarde, **Then** seuls les agents PFSO sélectionnés peuvent consulter l'activité, et les permissions individuelles sont enregistrées
4. **Given** un agent PFSO consulte la liste des activités disponibles, **When** le système charge la liste, **Then** seules les activités de son installation avec permission "visible tous" OU avec permission individuelle pour cet agent sont affichées
5. **Given** un agent PFSO tente d'accéder directement à une activité via son URL, **When** il n'a pas de permission, **Then** le système retourne une erreur 403 (accès interdit) avec un message approprié
6. **Given** un formateur modifie les permissions d'une activité existante, **When** il retire l'accès à un agent PFSO qui avait précédemment accès, **Then** cet agent ne peut plus consulter l'activité, et un log d'audit enregistre cette modification
7. **Given** un formateur consulte les détails d'une activité, **When** il accède à la section permissions, **Then** il voit la liste complète des agents PFSO ayant actuellement accès, avec la date d'attribution de chaque permission

---

### User Story 4 - Gestion des Recommandations (Priority: P2)

Les formateurs RSO doivent pouvoir créer des recommandations liées aux activités d'entraînement, avec titre, description, priorité (critique, haute, moyenne, basse), responsable, date d'échéance, et suivre leur statut (en attente, en cours, terminée, validée, annulée). Les recommandations permettent de documenter les points d'amélioration identifiés lors des activités.

**Why this priority**: Les recommandations sont essentielles pour le suivi de la conformité ISPS. Lors des entraînements et exercices, des points d'amélioration sont identifiés et doivent être suivis jusqu'à résolution. Sans cette fonctionnalité, les recommandations restent informelles et peuvent être oubliées, compromettant la sécurité portuaire.

**Independent Test**: Un formateur RSO consulte une activité d'entraînement terminée. Il clique sur "Ajouter une recommandation", remplit le formulaire (titre: "Améliorer la signalétique d'évacuation", description détaillée, priorité: haute, responsable: un agent PFSO, échéance: dans 30 jours), et sauvegarde. La recommandation apparaît dans la liste des recommandations de l'activité. Plus tard, le responsable marque la recommandation comme "en cours", puis "terminée" avec des actions prises. Le formateur peut consulter toutes les recommandations avec filtres par statut, priorité, et installation.

**Acceptance Scenarios**:

1. **Given** un formateur RSO consulte une activité (notamment d'entraînement), **When** il accède à la section recommandations, **Then** il voit la liste des recommandations existantes (si présentes) et un bouton "Ajouter une recommandation"
2. **Given** un formateur clique sur "Ajouter une recommandation", **When** le formulaire s'ouvre, **Then** il peut saisir un titre (obligatoire, min 10 caractères), une description détaillée (obligatoire, min 150 caractères), sélectionner une priorité parmi les 4 niveaux, choisir un responsable (liste des agents PFSO et formateurs RSO), et définir une date d'échéance optionnelle
3. **Given** un formateur crée une recommandation avec priorité "critique", **When** il sauvegarde, **Then** la recommandation est enregistrée, le responsable reçoit une notification, et la recommandation apparaît dans la liste avec un indicateur visuel de priorité critique
4. **Given** un responsable consulte une recommandation qui lui est assignée, **When** il met à jour le statut (en attente → en cours → terminée), **Then** le statut est enregistré, et s'il marque comme terminée, il peut renseigner les actions prises et la date de résolution
5. **Given** un formateur consulte la page de suivi des recommandations, **When** il applique des filtres (statut, priorité, installation, période), **Then** la liste est filtrée et affiche uniquement les recommandations correspondantes
6. **Given** une recommandation a une date d'échéance dépassée et un statut "en attente" ou "en cours", **When** le système génère la liste des recommandations, **Then** cette recommandation apparaît dans une section "Recommandations en retard" avec un indicateur visuel d'alerte et le nombre de jours de retard
7. **Given** un formateur consulte les statistiques des recommandations, **When** il accède à la page de suivi, **Then** il voit des indicateurs : nombre total de recommandations, nombre en attente, nombre en cours, nombre terminées, et nombre en retard
8. **Given** une recommandation est liée à une activité, **When** un utilisateur consulte l'activité, **Then** il voit la liste des recommandations de cette activité avec leurs statuts et priorités, et peut cliquer pour voir les détails

---

### User Story 5 - Consultation des Activités par les Agents PFSO (Priority: P2)

Les agents PFSO doivent pouvoir consulter les activités de leur installation pour lesquelles ils ont reçu une permission, avec possibilité de recherche, filtrage, export PDF, et impression. Ils ne peuvent que consulter (lecture seule), sans possibilité de modification.

**Why this priority**: Les agents PFSO sont les destinataires principaux des activités créées par les formateurs RSO. Ils doivent pouvoir accéder facilement aux rapports, exercices, et formations pour leur installation, les consulter en détail, et les exporter pour leurs archives ou présentations. Leur accès est en lecture seule pour préserver l'intégrité des documents officiels.

**Independent Test**: Un agent PFSO connecté accède à la page de consultation des activités. Il voit uniquement les activités de son installation avec permissions. Il peut filtrer par année (pré-remplie), type d'activité, et rechercher par mot-clé. Il clique sur une activité pour voir le contenu complet avec tous les éléments (texte formaté, tableaux, images, cartes, vidéos). Il peut exporter en PDF ou imprimer. Il ne voit aucun bouton de modification ou suppression.

**Acceptance Scenarios**:

1. **Given** un agent PFSO est connecté, **When** il accède à la page de consultation des activités, **Then** il voit uniquement les activités de son installation pour lesquelles il a une permission (visible tous OU permission individuelle), avec l'installation verrouillée et non modifiable
2. **Given** un agent PFSO consulte la liste des activités, **When** il applique des filtres (année, type d'activité) et une recherche par mot-clé, **Then** la liste est filtrée et affiche uniquement les activités correspondantes avec pagination
3. **Given** un agent PFSO clique sur une activité pour la consulter, **When** la page de détails s'affiche, **Then** il voit toutes les informations (titre, type, date, durée, lieu, participants, contenu complet avec formatage, recommandations), mais aucun bouton de modification ou suppression
4. **Given** un agent PFSO consulte une activité, **When** il clique sur "Télécharger PDF", **Then** un PDF professionnel est généré avec le contenu complet de l'activité, le logo de l'organisation, les métadonnées, et les recommandations, et le téléchargement démarre automatiquement
5. **Given** un agent PFSO consulte une activité, **When** il clique sur "Imprimer", **Then** la boîte de dialogue d'impression du navigateur s'ouvre avec une mise en page optimisée pour l'impression (sans éléments de navigation, avec en-têtes et pieds de page appropriés)
6. **Given** un agent PFSO consulte une activité avec visioconférence, **When** il voit les informations de l'activité, **Then** le lien de visioconférence est affiché et cliquable pour rejoindre la session si elle est encore active
7. **Given** un agent PFSO tente d'accéder à une activité sans permission, **When** il utilise directement l'URL, **Then** le système retourne une erreur 403 avec un message indiquant qu'il n'a pas l'autorisation de consulter cette activité

---

### User Story 6 - Recherche Avancée d'Activités (Priority: P2)

Tous les utilisateurs autorisés (formateurs RSO, administrateurs) doivent pouvoir effectuer une recherche avancée dans toutes les activités avec recherche full-text dans les titres et contenus, filtres multiples (année, installation, type, statut, période), et tri par pertinence, date, ou titre.

**Why this priority**: Avec le temps, le nombre d'activités va croître significativement. Les utilisateurs doivent pouvoir retrouver rapidement une activité spécifique parmi des centaines, que ce soit par mot-clé, par critères, ou par combinaison des deux. La recherche full-text permet de trouver des activités même si on ne se souvient que d'un détail du contenu.

**Independent Test**: Un formateur RSO accède à la page de recherche avancée. Il saisit "évacuation" dans le champ de recherche, sélectionne l'année 2024, l'installation "Port de commerce", le type "Entraînements", et la période "Janvier à Mars 2024". Il lance la recherche. Le système retourne 8 résultats avec le mot "évacuation" mis en surbrillance, triés par pertinence. Chaque résultat affiche un extrait du contenu avec les mots-clés en surbrillance, la date, l'installation, et un score de pertinence.

**Acceptance Scenarios**:

1. **Given** un utilisateur autorisé accède à la page de recherche avancée, **When** il saisit un mot-clé dans le champ de recherche, **Then** le système recherche dans les titres et contenus texte de toutes les activités auxquelles il a accès, et retourne les résultats avec le mot-clé mis en surbrillance
2. **Given** un utilisateur applique des filtres (année, installation, type, statut, période), **When** il combine ces filtres avec une recherche par mot-clé, **Then** le système retourne uniquement les activités correspondant à tous les critères, avec le mot-clé mis en surbrillance dans les résultats
3. **Given** un utilisateur effectue une recherche, **When** les résultats s'affichent, **Then** chaque résultat montre un extrait du contenu avec les mots-clés en surbrillance, la date formatée, l'installation, le type, un score de pertinence (si recherche full-text), et un lien vers l'activité complète
4. **Given** un utilisateur consulte les résultats de recherche, **When** il choisit un tri (pertinence, date décroissante, date croissante, titre A-Z), **Then** les résultats sont réorganisés selon le critère sélectionné
5. **Given** un utilisateur effectue une recherche qui retourne de nombreux résultats, **When** les résultats s'affichent, **Then** la pagination est activée (par exemple 20 résultats par page), et l'utilisateur peut naviguer entre les pages
6. **Given** un utilisateur a effectué une recherche avec plusieurs filtres, **When** il clique sur "Réinitialiser", **Then** tous les champs sont vidés et les filtres réinitialisés à leurs valeurs par défaut
7. **Given** un agent PFSO effectue une recherche, **When** le système retourne les résultats, **Then** seules les activités pour lesquelles il a une permission sont incluses dans les résultats, même si d'autres activités correspondent aux critères de recherche

---

### User Story 7 - Gestion et Liste des Activités (Priority: P2)

Les formateurs RSO doivent pouvoir consulter la liste de toutes leurs activités avec filtres rapides (installation, type, statut), voir les informations clés de chaque activité (titre, type, installation, date, durée, participants, statut), et accéder aux actions (voir, modifier, exporter, supprimer) pour chaque activité.

**Why this priority**: Les formateurs créent de nombreuses activités au fil du temps. Ils doivent pouvoir gérer efficacement leur bibliothèque d'activités, retrouver rapidement une activité spécifique, voir l'état de chaque activité, et effectuer les actions courantes (modification, export, suppression) directement depuis la liste.

**Independent Test**: Un formateur RSO accède à la page de gestion des activités. Il voit la liste de toutes ses activités avec les informations clés. Il applique un filtre "Installation: Port de commerce" et "Type: Entraînements" et "Statut: Terminé". La liste se met à jour pour afficher uniquement les activités correspondantes. Il clique sur "Voir" pour une activité, consulte les détails, puis revient à la liste. Il clique sur "Exporter PDF" pour une autre activité, et le PDF est généré et téléchargé.

**Acceptance Scenarios**:

1. **Given** un formateur RSO accède à la page de gestion des activités, **When** la page se charge, **Then** il voit la liste de toutes ses activités (pas celles d'autres formateurs sauf s'il est admin), avec pagination si nécessaire, et des filtres rapides en haut (installation, type, statut)
2. **Given** un formateur consulte la liste des activités, **When** il regarde une activité, **Then** il voit les informations clés : type et sous-type avec icône, titre, installation, date formatée, durée, nombre de participants, statut avec code couleur, et actions disponibles (voir, modifier, exporter, supprimer)
3. **Given** un formateur applique des filtres (installation, type, statut), **When** il sélectionne les valeurs, **Then** la liste se met à jour automatiquement pour afficher uniquement les activités correspondantes, et l'URL est mise à jour pour permettre le partage de la vue filtrée
4. **Given** un formateur clique sur "Voir" pour une activité, **When** la page de détails s'affiche, **Then** il voit toutes les informations complètes de l'activité avec possibilité de revenir à la liste
5. **Given** un formateur clique sur "Modifier" pour une activité, **When** la page d'édition s'affiche, **Then** tous les champs sont pré-remplis avec les valeurs actuelles, et il peut modifier le contenu dans l'éditeur
6. **Given** un formateur clique sur "Exporter PDF" pour une activité, **When** il confirme, **Then** un PDF professionnel est généré avec le contenu complet et téléchargé automatiquement
7. **Given** un formateur clique sur "Supprimer" pour une activité, **When** il confirme la suppression, **Then** l'activité est marquée comme supprimée (soft delete), disparaît de la liste principale, mais reste accessible pour les administrateurs dans les archives
8. **Given** un administrateur consulte la liste des activités, **When** la page se charge, **Then** il voit toutes les activités de tous les formateurs, avec indication du créateur, et peut effectuer toutes les actions (modifier, supprimer, valider) sur n'importe quelle activité

---

### Edge Cases

- Que se passe-t-il si un formateur tente de créer une activité avec un code d'activité qui existe déjà ? (Le système doit générer un code unique, donc cela ne devrait pas arriver, mais si c'est le cas, générer un nouveau numéro séquentiel)
- Comment le système gère-t-il la suppression d'une installation qui a des activités associées ? (Les activités doivent être préservées pour l'historique, mais l'installation peut être marquée comme inactive)
- Que se passe-t-il si un agent PFSO est supprimé alors qu'il a des recommandations assignées ? (Les recommandations doivent être réassignées ou marquées comme "sans responsable")
- Comment le système gère-t-il les activités créées dans une année qui est ensuite supprimée ? (Les activités doivent être préservées, mais l'année peut être marquée comme archivée)
- Que se passe-t-il si un formateur tente d'uploader une image de très grande taille (>10MB) ? (Le système doit rejeter le fichier avec un message d'erreur et suggérer une compression)
- Comment le système gère-t-il les caractères spéciaux et les emojis dans les titres et contenus ? (Le système doit supporter UTF-8 complet et préserver tous les caractères)
- Que se passe-t-il si un formateur crée une activité mais n'a pas sauvegardé depuis longtemps et perd sa connexion internet ? (L'auto-sauvegarde locale doit être restaurée au retour de la connexion)
- Comment le système gère-t-il les activités avec un très long contenu (>100 000 caractères) ? (Le système doit supporter les contenus volumineux sans dégradation de performance)
- Que se passe-t-il si un formateur modifie une activité alors qu'un agent PFSO est en train de la consulter ? (L'agent PFSO voit la version actuelle, pas de verrouillage nécessaire pour la consultation)
- Comment le système gère-t-il les recommandations avec une date d'échéance dans le passé lors de la création ? (Le système doit accepter mais afficher un avertissement que l'échéance est déjà passée)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow formateurs RSO to create activities following a guided workflow: year selection (pre-filled from session) → installation selection → activity type selection (with hierarchical sub-types if applicable) → general information entry → rich text editor for content
- **FR-002**: System MUST automatically generate a unique activity code for each activity in the format ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN (e.g., ACT-2024-PAD_COM-ENT-T1-001)
- **FR-003**: System MUST provide a rich text editor that supports text formatting (bold, italic, underline, headings H1-H4), table creation and editing, image insertion with upload, video embedding (YouTube, Vimeo), Google Maps embedding, and image gallery creation
- **FR-004**: System MUST automatically save activity content every 30 seconds without user intervention and display the last save time
- **FR-005**: System MUST warn users before leaving the page if there are unsaved changes in the editor
- **FR-006**: System MUST store both HTML content (for display) and plain text content (for full-text search) for each activity
- **FR-007**: System MUST validate that activity dates fall within the selected year
- **FR-008**: System MUST require a video conference link if a video conference platform is selected
- **FR-009**: System MUST validate video conference links as valid URLs
- **FR-010**: System MUST allow formateurs RSO to set visibility permissions for each activity: either "visible to all PFSO agents of the installation" or individual PFSO agent selection
- **FR-011**: System MUST enforce that PFSO agents can only view activities for which they have explicit permission (either "visible to all" for their installation OR individual permission)
- **FR-012**: System MUST return a 403 (Forbidden) error when a PFSO agent attempts to access an activity without permission
- **FR-013**: System MUST allow formateurs RSO to create recommendations linked to activities (especially training activities) with title, description, priority (critical, high, medium, low), responsible person, and due date
- **FR-014**: System MUST track recommendation status (pending, in progress, completed, validated, cancelled) and allow status updates by responsible persons
- **FR-015**: System MUST display recommendations that are past due date with a visual alert and count of days overdue
- **FR-016**: System MUST provide statistics on recommendations: total count, count by status, count overdue
- **FR-017**: System MUST allow PFSO agents to view activities in read-only mode (no edit or delete buttons visible)
- **FR-018**: System MUST allow PFSO agents to export activities to PDF format with professional formatting including logo, metadata, content, and recommendations
- **FR-019**: System MUST allow PFSO agents to print activities with optimized print layout (no navigation elements, appropriate headers and footers)
- **FR-020**: System MUST provide advanced search functionality with full-text search in activity titles and content, filters (year, installation, type, status, date range), and sorting options (relevance, date, title)
- **FR-021**: System MUST highlight search keywords in search results with excerpts showing context
- **FR-022**: System MUST respect permission restrictions in search results (PFSO agents only see activities they have permission to view)
- **FR-023**: System MUST provide activity list management for formateurs RSO with quick filters (installation, type, status), key information display, and actions (view, edit, export, delete)
- **FR-024**: System MUST allow formateurs RSO to modify only their own activities (unless they are administrators)
- **FR-025**: System MUST allow administrators to view, modify, and delete all activities regardless of creator
- **FR-026**: System MUST implement soft delete for activities (mark as deleted, preserve in database, hide from main list but accessible to administrators)
- **FR-027**: System MUST validate image uploads (file type, size limits) and reject invalid files with appropriate error messages
- **FR-028**: System MUST support hierarchical activity types with parent types and sub-types (e.g., "Entraînements" → "Trimestre 1/2/3/4", "Exercice Annuel" → "Séminaire/Sur Table/Grandeur Nature")
- **FR-029**: System MUST require sub-type selection when the selected activity type has sub-types
- **FR-030**: System MUST allow formateurs RSO to change activity status (draft, in progress, completed, validated, archived)
- **FR-031**: System MUST log all permission changes for audit purposes
- **FR-032**: System MUST notify responsible persons when recommendations are assigned to them
- **FR-033**: System MUST allow responsible persons to update recommendation status and add resolution details when marking as completed

### Key Entities *(include if feature involves data)*

- **Activity**: Represents a security activity report, exercise, training, audit, or evaluation. Key attributes: unique code, title, year, installation, activity type and sub-type, rich HTML content, plain text content for search, date, duration, location, number of participants, video conference link and platform, status, visibility permissions, creator, creation and update timestamps, validator and validation date. Relationships: belongs to one year, one installation, one activity type, created by one user, optionally validated by one user, has many recommendations, has many media files, has many PFSO access permissions.

- **Activity Type**: Represents the hierarchical classification of activities according to ISPS code. Key attributes: code (unique identifier), label, description, parent type (for hierarchy), display order, icon, color, active status. Relationships: can have many sub-types (children), belongs to one parent type (if sub-type), has many activities.

- **Recommendation**: Represents an improvement point identified during an activity. Key attributes: title, description, priority level (critical, high, medium, low), status (pending, in progress, completed, validated, cancelled), due date, responsible person, resolution date, actions taken, resolver. Relationships: belongs to one activity, assigned to one user (responsible), optionally resolved by one user.

- **PFSO Access Permission**: Represents the permission granted to a PFSO agent to view a specific activity. Key attributes: activity reference, user reference (PFSO agent), grantor (RSO who granted access), grant timestamp. Relationships: belongs to one activity, references one PFSO agent user, granted by one RSO user.

- **Activity Media**: Represents media files (images, videos, documents) attached to an activity. Key attributes: activity reference, media type (image, video, document), filename, file path, file size, MIME type, caption, display order, uploader, upload timestamp. Relationships: belongs to one activity, uploaded by one user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Formateurs RSO can complete the full activity creation workflow (from year selection to content saving) in under 5 minutes for a basic activity with text only
- **SC-002**: The rich text editor loads and is ready for input in under 2 seconds on standard broadband connection
- **SC-003**: Auto-save functionality prevents data loss - 100% of content edits are automatically saved within 30 seconds without user action
- **SC-004**: Full-text search returns relevant results in under 1 second for a database of up to 1000 activities
- **SC-005**: PDF export generates a professional document in under 5 seconds for activities with up to 10 pages of content
- **SC-006**: 95% of formateurs RSO can successfully create an activity with all required fields on their first attempt without training
- **SC-007**: PFSO agents can find and access a specific activity they have permission to view in under 30 seconds using search or filters
- **SC-008**: The system supports activities with content up to 200,000 characters without performance degradation
- **SC-009**: Image uploads complete successfully for files up to 5MB in under 10 seconds on standard broadband
- **SC-010**: Permission changes take effect immediately - PFSO agents see or lose access to activities within 1 second of permission modification
- **SC-011**: Recommendation tracking enables 90% of recommendations to be resolved before their due date when properly assigned and tracked
- **SC-012**: The activity list displays and filters correctly for users with up to 500 activities in their scope
- **SC-013**: All activity data is preserved and recoverable - 0% data loss rate for activities that have been auto-saved at least once

## Out of Scope

- **Media Management (Phase 4)**: Advanced media library, bulk media operations, media versioning, and advanced media organization features are planned for Phase 4. Basic image upload for the editor is included in Phase 3, but full media management is deferred.
- **Advanced Analytics**: Detailed analytics dashboards, activity completion rates, participation statistics, and trend analysis are not included in Phase 3. Basic statistics for recommendations are included.
- **Collaborative Editing**: Real-time collaborative editing of activities, comments, and suggestions from multiple users simultaneously is not included. Activities are edited by one user at a time.
- **Activity Templates**: Pre-defined activity templates, activity cloning, and template library are not included in Phase 3. Each activity is created from scratch.
- **Email Notifications**: Automated email notifications for activity creation, permission changes, recommendation assignments, and due date reminders are not included in Phase 3. Basic in-app notifications may be included.
- **Mobile App**: Native mobile applications for iOS and Android are out of scope. The system is web-based and should be responsive for mobile browsers, but native apps are deferred.
- **Offline Mode**: Full offline functionality for creating and editing activities without internet connection is not included. Auto-save works online only.
- **Version History**: Detailed version history and rollback capabilities for activities are not included. Only current version and basic update timestamps are tracked.
- **Advanced Reporting**: Custom report generation, scheduled reports, and advanced export formats (Excel, Word) beyond PDF are not included in Phase 3.
- **Integration with External Systems**: Integration with external ISPS compliance systems, port management systems, or third-party platforms is out of scope for Phase 3.

## Dependencies

- **Phase 1 - Authentication**: User authentication, role-based access control (RSO, PFSO, Admin, Sûreté), and session management must be fully implemented and functional. The activity system relies on user roles and permissions from Phase 1.
- **Phase 2 - Installations**: Installation management, year selection, and installation-user relationships must be complete. Activities are linked to installations and years from Phase 2.
- **Database Schema**: The database must support the new tables for activities, activity types, recommendations, and permissions. Migration scripts must be created and tested.
- **File Storage**: Basic file storage system for uploaded images must be available. The system needs a location to store uploaded images from the rich text editor.
- **PDF Generation Library**: A library or service for generating PDF documents from HTML content must be available or integrated.
- **Search Engine**: Full-text search capabilities must be available, either through database full-text indexes or an external search engine.

## Assumptions

- Users have modern web browsers (Chrome, Firefox, Safari, Edge) with JavaScript enabled
- Internet connection is available during activity creation and editing (no offline mode)
- Formateurs RSO have basic computer literacy and can use a rich text editor
- Activity content will primarily be in French, but the system should support UTF-8 for special characters
- Images uploaded will typically be photos from training sessions, with file sizes ranging from 100KB to 5MB
- Activities will be created regularly throughout the year, with peak activity during training periods
- The system will handle up to 1000 activities per year per installation without significant performance issues
- PFSO agents will primarily access activities for consultation and reference, not for frequent editing
- Administrators will occasionally need to access and manage activities from all formateurs
- The rich text editor will be the primary interface for content creation, and users will adapt to its features over time

