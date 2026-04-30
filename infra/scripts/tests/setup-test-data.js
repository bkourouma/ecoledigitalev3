const API_BASE = 'http://localhost:4000';
const TENANT = 'imhotepacademy';

async function setupTestData() {
  console.log('🛠️  Configuration des données de test pour l\'emploi du temps\n');

  try {
    // 1. Vérifier l'API
    console.log('1️⃣ Vérification de l\'API...');
    const healthResponse = await fetch(`${API_BASE}/api/v1/health`);
    if (!healthResponse.ok) {
      console.log('❌ API non accessible. Assurez-vous que l\'API est démarrée sur le port 4000');
      return;
    }
    console.log('✅ API accessible');

    // 2. Vérifier les cycles existants
    console.log('\n2️⃣ Vérification des cycles...');
    const cyclesResponse = await fetch(`${API_BASE}/api/v1/cycles`, {
      headers: { 'X-Tenant': TENANT }
    });
    
    let cycleId = null;
    if (cyclesResponse.ok) {
      const cyclesData = await cyclesResponse.json();
      if (cyclesData.data && cyclesData.data.length > 0) {
        cycleId = cyclesData.data[0].id;
        console.log('✅ Cycle trouvé:', cyclesData.data[0].name);
      }
    }

    // Créer un cycle si nécessaire
    if (!cycleId) {
      console.log('📝 Création d\'un cycle de test...');
      const createCycleResponse = await fetch(`${API_BASE}/api/v1/cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': TENANT
        },
        body: JSON.stringify({
          name: 'BTS - Brevet de Technicien Supérieur',
          code: 'BTS',
          description: 'Cycle de formation BTS',
          duration: 2,
          level: 'higher_education'
        })
      });

      if (createCycleResponse.ok) {
        const cycleData = await createCycleResponse.json();
        cycleId = cycleData.data.id;
        console.log('✅ Cycle créé:', cycleData.data.name);
      } else {
        console.log('❌ Erreur création cycle:', await createCycleResponse.text());
        return;
      }
    }

    // 3. Vérifier les programmes
    console.log('\n3️⃣ Vérification des programmes...');
    const programmesResponse = await fetch(`${API_BASE}/api/v1/programmes`, {
      headers: { 'X-Tenant': TENANT }
    });
    
    let programmeId = null;
    if (programmesResponse.ok) {
      const programmesData = await programmesResponse.json();
      if (programmesData.data && programmesData.data.length > 0) {
        programmeId = programmesData.data[0].id;
        console.log('✅ Programme trouvé:', programmesData.data[0].name);
      }
    }

    // Créer un programme si nécessaire
    if (!programmeId) {
      console.log('📝 Création d\'un programme de test...');
      const createProgrammeResponse = await fetch(`${API_BASE}/api/v1/programmes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': TENANT
        },
        body: JSON.stringify({
          cycleId: cycleId,
          name: 'Informatique de Gestion',
          code: 'IDA',
          description: 'Programme d\'informatique de gestion',
          status: 'active'
        })
      });

      if (createProgrammeResponse.ok) {
        const programmeData = await createProgrammeResponse.json();
        programmeId = programmeData.data.id;
        console.log('✅ Programme créé:', programmeData.data.name);
      } else {
        console.log('❌ Erreur création programme:', await createProgrammeResponse.text());
        return;
      }
    }

    // 4. Vérifier les années académiques
    console.log('\n4️⃣ Vérification des années académiques...');
    const academicYearsResponse = await fetch(`${API_BASE}/api/v1/academic-years`, {
      headers: { 'X-Tenant': TENANT }
    });
    
    let academicYearId = null;
    if (academicYearsResponse.ok) {
      const academicYearsData = await academicYearsResponse.json();
      if (academicYearsData.data && academicYearsData.data.length > 0) {
        // Chercher l'année active ou prendre la première
        const activeYear = academicYearsData.data.find(y => y.isActive) || academicYearsData.data[0];
        academicYearId = activeYear.id;
        console.log('✅ Année académique trouvée:', activeYear.name);
      }
    }

    // Créer une année académique si nécessaire
    if (!academicYearId) {
      console.log('📝 Création d\'une année académique de test...');
      const createAcademicYearResponse = await fetch(`${API_BASE}/api/v1/academic-years`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': TENANT
        },
        body: JSON.stringify({
          name: '2024-2025',
          startDate: '2024-09-01',
          endDate: '2025-06-30',
          isActive: true
        })
      });

      if (createAcademicYearResponse.ok) {
        const academicYearData = await createAcademicYearResponse.json();
        academicYearId = academicYearData.data.id;
        console.log('✅ Année académique créée:', academicYearData.data.name);
      } else {
        console.log('❌ Erreur création année académique:', await createAcademicYearResponse.text());
        return;
      }
    }

    // 5. Vérifier les cours
    console.log('\n5️⃣ Vérification des cours...');
    const coursesResponse = await fetch(`${API_BASE}/api/v1/courses`, {
      headers: { 'X-Tenant': TENANT }
    });
    
    let courseIds = [];
    if (coursesResponse.ok) {
      const coursesData = await coursesResponse.json();
      if (coursesData.data && coursesData.data.length > 0) {
        courseIds = coursesData.data.slice(0, 3).map(c => c.id); // Prendre les 3 premiers cours
        console.log('✅ Cours trouvés:', coursesData.data.length);
      }
    }

    // Créer des cours si nécessaire
    if (courseIds.length === 0) {
      console.log('📝 Création de cours de test...');
      const testCourses = [
        { name: 'Programmation Web', code: 'PROG-WEB', credits: 4 },
        { name: 'Base de Données', code: 'BDD', credits: 3 },
        { name: 'Réseaux Informatiques', code: 'RESEAUX', credits: 3 }
      ];

      for (const course of testCourses) {
        const createCourseResponse = await fetch(`${API_BASE}/api/v1/courses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant': TENANT
          },
          body: JSON.stringify({
            ...course,
            description: `Cours de ${course.name}`,
            isRequired: true
          })
        });

        if (createCourseResponse.ok) {
          const courseData = await createCourseResponse.json();
          courseIds.push(courseData.data.id);
          console.log('✅ Cours créé:', courseData.data.name);
        }
      }
    }

    // 6. Créer une classe de test
    console.log('\n6️⃣ Création d\'une classe de test...');
    const createClassResponse = await fetch(`${API_BASE}/api/v1/classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': TENANT
      },
      body: JSON.stringify({
        programmeId: programmeId,
        academicYearId: academicYearId,
        name: 'BTS IDA - Première Année',
        code: 'BTS-IDA-01',
        maxStudents: 30,
        courseIds: courseIds
      })
    });

    if (createClassResponse.ok) {
      const classData = await createClassResponse.json();
      console.log('✅ Classe créée:', classData.data.name);
      
      // 7. Vérifier que la classe apparaît dans la liste
      console.log('\n7️⃣ Vérification de la liste des classes...');
      const verifyClassesResponse = await fetch(`${API_BASE}/api/v1/classes`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': TENANT
        }
      });

      if (verifyClassesResponse.ok) {
        const verifyData = await verifyClassesResponse.json();
        console.log('✅ Classes disponibles:', verifyData.data?.length || 0);
        
        if (verifyData.data?.length > 0) {
          console.log('📋 Classes trouvées:');
          verifyData.data.forEach(cls => {
            console.log(`  - ${cls.name} (${cls.code})`);
          });
        }
      }

      console.log('\n🎉 Configuration terminée avec succès !');
      console.log('Vous pouvez maintenant utiliser le système d\'emploi du temps.');
      
    } else {
      const errorData = await createClassResponse.text();
      console.log('❌ Erreur création classe:', errorData);
    }

  } catch (error) {
    console.log('❌ Erreur générale:', error.message);
  }
}

// Exécuter la configuration
setupTestData().catch(console.error);
