async function logout(event) {
    if (event) event.preventDefault();
    try {
        await window.supabaseClient?.auth.signOut();
    } finally {
        window.location.replace('login.html');
    }
}

        const formationsCatalogue = new Map();
        let currentStudent = null;
        let courses = [];
        let purchases = [];
        let questions = [];
        let exerciseSubmissions = [];
        let certificateCourseIds = new Set();

        function readCurrentStudent() {
            return currentStudent;
        }

        function readCourses() {
            return courses;
        }

        function readPurchases() {
            return purchases;
        }

        function readQuestions() {
            return questions;
        }

        function readExerciseSubmissions() {
            return exerciseSubmissions;
        }

        function mapCourse(row) {
            return {
                id: row.id,
                formationId: row.formation_id || '',
                title: row.title || 'Cours',
                description: row.description || '',
                teacher: row.teacher || 'IP Center Mali',
                teacherId: row.professor_id || '',
                teacherEmail: row.teacher_email || '',
                price: Number(row.price || 0),
                thumbnail: row.thumbnail_url || '',
                youtubeUrl: row.youtube_url || '',
                videoUrl: row.video_url || '',
                pdfUrl: row.pdf_url || '',
                exercises: Array.isArray(row.exercises) ? row.exercises : [],
                createdAt: row.created_at,
                isOpen: row.is_open !== false
            };
        }

        function mapSubmission(row) {
            return {
                id: row.id,
                courseId: row.course_id,
                courseTitle: row.course_title,
                exerciseId: row.exercise_id,
                exerciseText: row.exercise_text,
                maxScore: row.max_score,
                studentId: row.student_id,
                studentEmail: row.student_email,
                studentName: row.student_name,
                teacherId: row.teacher_id,
                answer: row.answer,
                status: row.status,
                grade: row.grade,
                feedback: row.feedback,
                submittedAt: row.submitted_at,
                gradedAt: row.graded_at,
                graderId: row.grader_id
            };
        }

        async function loadStudentData() {
            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');

            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData?.user) {
                const formation = new URLSearchParams(window.location.search).get('formation');
                window.location.replace(formation
                    ? `login.html?formation=${encodeURIComponent(formation)}`
                    : 'login.html');
                return false;
            }

            const user = authData.user;
            const { data: profile, error: profileError } = await client
                .from('profiles')
                .select('full_name, role, status')
                .eq('id', user.id)
                .maybeSingle();
            if (profileError) throw profileError;
            if (profile?.status === 'Bloqué') {
                await client.auth.signOut();
                throw new Error('Ce compte étudiant est bloqué.');
            }
            if (profile?.role !== 'student') {
                throw new Error('Ce compte ne possède pas le rôle étudiant.');
            }

            currentStudent = {
                id: user.id,
                email: user.email || '',
                name: profile.full_name || user.user_metadata?.nom || user.email || 'Étudiant',
                role: profile.role
            };
            const welcomeName = document.getElementById('studentWelcomeName');
            if (welcomeName) welcomeName.textContent = currentStudent.name;

            const [
                courseResult,
                formationResult,
                courseAccessResult,
                formationAccessResult,
                questionResult,
                submissionResult,
                certificateResult
            ] = await Promise.all([
                client.from('cours')
                    .select('id, formation_id, title, description, professor_id, teacher, teacher_email, price, thumbnail_url, youtube_url, video_url, pdf_url, exercises, created_at, is_open, status')
                    .eq('status', 'Publié'),
                client.from('formations')
                    .select('*'),
                client.from('student_course_access')
                    .select('course_id, created_at')
                    .eq('student_id', user.id),
                client.from('student_formation_access')
                    .select('formation_id, created_at')
                    .eq('student_id', user.id),
                client.from('student_questions')
                    .select('id, course_title, question, response, status, created_at, responded_at')
                    .eq('student_id', user.id)
                    .order('created_at', { ascending: false }),
                client.from('exercise_submissions')
                    .select('*')
                    .eq('student_id', user.id)
                    .order('submitted_at', { ascending: false }),
                client.from('student_certificates')
                    .select('course_id')
                    .eq('student_id', user.id)
            ]);

            for (const result of [
                courseResult,
                formationResult,
                courseAccessResult,
                formationAccessResult,
                questionResult,
                submissionResult,
                certificateResult
            ]) {
                if (result.error) throw result.error;
            }

            formationsCatalogue.clear();
            const publishedFormations = (formationResult.data || []).map((formation) => {
                const formationId = String(formation.id);
                formationsCatalogue.set(formationId, formation);
                return {
                    id: `formation-${formationId}`,
                    formationId,
                    isFormation: true,
                    isOpen: formation.is_open !== false,
                    title: formation.title || formation.titre || 'Formation',
                    category: formation.categorie || '',
                    description: formation.description || '',
                    teacher: formation.teacher || formation.professeur || 'IP Center Mali',
                    teacherId: '',
                    teacherEmail: '',
                    price: Number(formation.prix || 0),
                    thumbnail: formation.couverture_url || '',
                    youtubeUrl: formation.youtube_url || '',
                    videoUrl: formation.video_url || '',
                    pdfUrl: formation.pdf_url || '',
                    exercises: [],
                    createdAt: formation.created_at
                };
            });

            courses = [
                ...(courseResult.data || []).map(mapCourse),
                ...publishedFormations
            ];
            renderQuestionCourseOptions();
            exerciseSubmissions = (submissionResult.data || []).map(mapSubmission);
            questions = questionResult.data || [];
            certificateCourseIds = new Set(
                (certificateResult.data || []).map((item) => String(item.course_id))
            );

            const courseById = new Map(courses.map((course) => [String(course.id), course]));
            purchases = (courseAccessResult.data || [])
                .map((access) => {
                    const course = courseById.get(String(access.course_id));
                    return course ? { ...course, purchasedAt: access.created_at } : null;
                })
                .filter(Boolean);

            const formationById = new Map(
                (formationResult.data || []).map((formation) => [String(formation.id), formation])
            );
            (formationAccessResult.data || []).forEach((access) => {
                const formation = formationById.get(String(access.formation_id));
                if (!formation) return;
                purchases.push({
                    id: String(formation.id),
                    isOpen: formation.is_open !== false,
                    title: formation.title || formation.titre || 'Formation',
                    category: formation.categorie || '',
                    description: formation.description || '',
                    teacher: formation.teacher || formation.professeur || 'IP Center Mali',
                    thumbnail: formation.couverture_url || '',
                    youtubeUrl: formation.youtube_url || '',
                    videoUrl: formation.video_url || '',
                    pdfUrl: formation.pdf_url || '',
                    exercises: [],
                    formationType: 'formation',
                    purchasedAt: access.created_at
                });
            });

            return true;
        }

        async function generateCourseCertificate(course) {
            const student = readCurrentStudent();
            const studentName = (student && student.name) ? student.name : 'Étudiant';
            if (certificateCourseIds.has(String(course.id))) {
                return;
            }

            if (!window.docx) {
                console.warn('Librairie docx introuvable. Certificat non genere.');
                return;
            }

            const { Document, Packer, Paragraph, TextRun, AlignmentType } = window.docx;
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({ text: 'ATTESTATION DE FORMATION', bold: true, size: 28, break: 1 })
                            ]
                        }),
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({ text: 'IP Center Mali', bold: true, size: 24 })
                            ]
                        }),
                        new Paragraph({ text: '' }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: `Je soussigné, IP Center Mali, atteste que :`, size: 22 })
                            ]
                        }),
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({ text: studentName.toUpperCase(), bold: true, size: 26 })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: `a suivi avec succès le cours : ${course.title || 'Cours'}`, size: 22 })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: `Professeur : ${course.teacher || 'IP Center Mali'}`, size: 20 })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: `Date : ${new Date().toLocaleDateString('fr-FR')}`, size: 20 })
                            ]
                        }),
                        new Paragraph({ text: '' }),
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({ text: 'Fait à Bamako, le ' + new Date().toLocaleDateString('fr-FR'), italic: true, size: 20 })
                            ]
                        })
                    ]
                }]
            });

            const blob = await Packer.toBlob(doc);
            const safeName = (studentName || 'etudiant').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
            const courseName = (course.title || 'cours').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
            const filename = `Attestation_${safeName}_${courseName}.docx`;
            const url = URL.createObjectURL(blob);

            const client = window.supabaseClient;
            if (!client) {
                URL.revokeObjectURL(url);
                throw new Error('Client Supabase indisponible.');
            }
            const { error } = await client.from('student_certificates').insert({
                student_id: student.id,
                course_id: String(course.id),
                course_title: course.title || 'Cours',
                student_name: studentName,
                filename
            });
            if (error) {
                URL.revokeObjectURL(url);
                throw error;
            }

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            certificateCourseIds.add(String(course.id));
        }

        function escapeHtml(value) {
            return String(value || '').replace(/[&<>"']/g, function (char) {
                return ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                })[char];
            });
        }

        function getStudentSubmission(courseId, exerciseId) {
            const student = readCurrentStudent();
            const role = String(student && student.role || '').trim().toLowerCase();
            if (!student || !['student', 'etudiant', 'étudiant'].includes(role)) return null;

            const email = String(student.email || '').trim().toLowerCase();
            const studentId = String(student.id || '');

            return readExerciseSubmissions().find((submission) =>
                String(submission.courseId) === String(courseId) &&
                String(submission.exerciseId) === String(exerciseId) &&
                (email
                    ? String(submission.studentEmail || '').trim().toLowerCase() === email
                    : String(submission.studentId || '') === studentId)
            ) || null;
        }

        function coursePassedForStudent(course) {
            const exercises = course.exercises || [];
            return exercises.length > 0 && exercises.every((exercise) => {
                const submission = getStudentSubmission(course.id, exercise.id || 'final');
                return submission && submission.status === 'graded' && Number(submission.grade) >= 10;
            });
        }

        function getYoutubeEmbedUrl(value) {
            if (!value) return '';

            try {
                const url = new URL(String(value));
                const host = url.hostname.toLowerCase().replace(/^www\./, '');
                let videoId = '';

                if (host === 'youtu.be') {
                    videoId = url.pathname.split('/').filter(Boolean)[0] || '';
                } else if (host === 'youtube.com' || host === 'm.youtube.com') {
                    const pathParts = url.pathname.split('/').filter(Boolean);
                    if (url.pathname === '/watch') {
                        videoId = url.searchParams.get('v') || '';
                    } else if (['embed', 'shorts', 'live'].includes(pathParts[0])) {
                        videoId = pathParts[1] || '';
                    }
                }

                return /^[A-Za-z0-9_-]{11}$/.test(videoId)
                    ? 'https://www.youtube-nocookie.com/embed/' + videoId
                    : '';
            } catch (error) {
                return '';
            }
        }

        function showSection(sectionKey) {
            document.querySelectorAll('.nav-btn').forEach((button) => {
                button.classList.toggle('active', button.dataset.target === sectionKey);
            });
            document.querySelectorAll('.panel').forEach((panel) => {
                panel.classList.toggle('active', panel.id === sectionKey);
            });
            requestAnimationFrame(actualiserToutesNavigationsDescriptions);
        }

        function actualiserNavigationDescription(description, navigation, precedent, suivant) {
            const defilementMax = Math.max(0, description.scrollHeight - description.clientHeight);
            navigation.hidden = defilementMax <= 1;
            precedent.hidden = defilementMax <= 1 || description.scrollTop <= 1;
            suivant.hidden = defilementMax <= 1 || description.scrollTop >= defilementMax - 1;
        }

        function rendreBlocDescriptionHtml(texte, classeSupplementaire) {
            return `
                <div class="dashboard-formation-description ${classeSupplementaire}">
                    <p class="dashboard-formation-description-text">${escapeHtml(texte)}</p>
                    <div class="dashboard-formation-description-navigation" role="group" aria-label="Navigation dans la description">
                        <button class="dashboard-formation-description-button dashboard-formation-description-previous" type="button" hidden>Précédent</button>
                        <button class="dashboard-formation-description-button dashboard-formation-description-next" type="button" hidden>Suivant</button>
                    </div>
                </div>
            `;
        }

        function initialiserNavigationDescription(bloc) {
            const description = bloc.querySelector('.dashboard-formation-description-text');
            const navigation = bloc.querySelector('.dashboard-formation-description-navigation');
            const precedent = bloc.querySelector('.dashboard-formation-description-previous');
            const suivant = bloc.querySelector('.dashboard-formation-description-next');
            if (!description || !navigation || !precedent || !suivant) return;

            description.addEventListener('scroll', () => {
                actualiserNavigationDescription(description, navigation, precedent, suivant);
            }, { passive: true });
            precedent.addEventListener('click', () => defilerDescription(description, -1));
            suivant.addEventListener('click', () => defilerDescription(description, 1));
            actualiserNavigationDescription(description, navigation, precedent, suivant);
        }

        function actualiserToutesNavigationsDescriptions() {
            document.querySelectorAll('.dashboard-formation-description').forEach((bloc) => {
                const description = bloc.querySelector('.dashboard-formation-description-text');
                const navigation = bloc.querySelector('.dashboard-formation-description-navigation');
                const precedent = bloc.querySelector('.dashboard-formation-description-previous');
                const suivant = bloc.querySelector('.dashboard-formation-description-next');
                if (description && navigation && precedent && suivant) {
                    actualiserNavigationDescription(description, navigation, precedent, suivant);
                }
            });
        }

        function defilerDescription(description, direction) {
            const hauteurPage = description.clientHeight;
            const defilementMax = Math.max(0, description.scrollHeight - hauteurPage);
            const destination = Math.min(
                defilementMax,
                Math.max(0, description.scrollTop + direction * hauteurPage)
            );
            description.scrollTo({ top: destination, behavior: 'smooth' });
        }

        function renderCourses() {
            const courses = readCourses();
            const container = document.getElementById('coursesContainer');

            if (!container) return;

            if (!courses.length) {
                container.innerHTML = '<div class="empty-state">Aucun cours disponible pour le moment. Les cours publiés par l’administration et les professeurs apparaîtront ici.</div>';
                return;
            }

            container.innerHTML = courses.map((course) => {
                const isOpen = course.isOpen !== false;
                const youtubeEmbedUrl = getYoutubeEmbedUrl(course.youtubeUrl);
                const mediaHtml = !isOpen ? '' : course.thumbnail ? `<img src="${escapeHtml(course.thumbnail)}" alt="${escapeHtml(course.title)}">`
                    : !course.isFormation && youtubeEmbedUrl ? `<iframe src="${youtubeEmbedUrl}" title="Vidéo du cours ${escapeHtml(course.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
                    : !course.isFormation && course.videoUrl ? `<video controls src="${escapeHtml(course.videoUrl)}"></video>`
                    : '';

                const courseAction = !isOpen
                    ? '<button class="buy-btn" type="button" disabled>Cours fermé</button>'
                    : course.isFormation
                        ? `<button class="buy-btn" type="button" data-action="open-formation" data-formation-id="${escapeHtml(course.formationId)}">Accéder au cours</button>`
                        : `<button class="buy-btn" type="button" data-action="buy-course" data-course-id="${escapeHtml(course.id)}">Acheter</button>`;
                const categoryHtml = course.category
                    ? `<p><strong>Catégorie :</strong> ${escapeHtml(course.category)}</p>`
                    : '';
                const descriptionHtml = course.description
                    ? rendreBlocDescriptionHtml(course.description, 'dashboard-course-description')
                    : '';
                const pdfHtml = isOpen && course.pdfUrl && !course.isFormation
                    ? `<button type="button" class="link-btn" data-action="open-course-resource" data-collection="courses" data-index="${courses.indexOf(course)}" data-type="pdf">Voir le PDF</button>`
                    : '';
                const exercisesHtml = isOpen ? (course.exercises || []).map((exercise) => `
                        <div class="exercise-card">
                            <strong>Exercice pratique</strong>
                            <p>${escapeHtml(exercise.text)}</p>
                            <small>Note maximale : ${Number(exercise.maxScore || 20)}/20</small>
                        </div>
                    `).join('') : '';
                const searchText = [course.title, course.category, course.description, course.teacher]
                    .filter(Boolean)
                    .join(' ')
                    .toLocaleLowerCase('fr');

                return `
                    <article class="course-card ${isOpen ? '' : 'is-closed'}" data-search="${escapeHtml(searchText)}">
                        ${isOpen ? '' : '<span class="closed-course-notice">Cours fermé par l’administration</span>'}
                        ${mediaHtml || (isOpen ? `<div class="empty-state">${course.isFormation ? 'Ressources disponibles après ouverture du cours.' : 'Aucune ressource média'}</div>` : '')}
                        <h3>${escapeHtml(course.title)}</h3>
                        ${categoryHtml}
                        ${descriptionHtml}
                        <p><strong>Professeur :</strong> ${escapeHtml(course.teacher)}</p>
                        <div class="course-meta">
                            <span>${Number(course.price || 0).toLocaleString('fr-FR')} FCFA</span>
                            ${courseAction}
                        </div>
                        ${exercisesHtml}
                        ${pdfHtml}
                        <div id="course-resource-courses-${courses.indexOf(course)}"></div>
                    </article>
                `;
            }).join('');
            container.querySelectorAll('.dashboard-course-description')
                .forEach(initialiserNavigationDescription);
            filtrerCatalogueCours();
            requestAnimationFrame(actualiserToutesNavigationsDescriptions);
        }

        function filtrerCatalogueCours() {
            const input = document.getElementById('courseSearch');
            if (!input) return;
            const terme = input.value.trim().toLocaleLowerCase('fr');
            document.querySelectorAll('#coursesContainer .course-card').forEach((card) => {
                card.hidden = !card.dataset.search.includes(terme);
            });
        }

        function renderQuestionCourseOptions() {
            const select = document.getElementById('questionCourse');
            if (!select) return;

            const previousValue = select.value;
            select.innerHTML = `
                <option value="">Choisissez un cours...</option>
                <option value="__admin__">Question générale à l’administration</option>
                ${courses.filter((course) => course.isOpen !== false).map((course) => {
                    const destination = course.teacherId
                        ? `Professeur : ${course.teacher}`
                        : 'Administration';
                    return `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)} — ${escapeHtml(destination)}</option>`;
                }).join('')}
            `;
            if ([...select.options].some((option) => option.value === previousValue)) {
                select.value = previousValue;
            }
        }

        async function actualiserCatalogueCours() {
            const button = document.getElementById('refreshCourseCatalog');
            const feedback = document.getElementById('courseCatalogFeedback');
            if (button) button.disabled = true;
            if (feedback) {
                feedback.textContent = 'Actualisation du catalogue...';
                feedback.hidden = false;
            }

            try {
                const client = window.supabaseClient;
                if (!client) throw new Error('Client Supabase indisponible.');

                const { data, error } = await client.from('cours')
                    .select('id, formation_id, title, description, professor_id, teacher, teacher_email, price, thumbnail_url, youtube_url, video_url, pdf_url, exercises, created_at, is_open, status')
                    .eq('status', 'Publié')
                    .order('created_at', { ascending: false });
                if (error) throw error;

                const formationCourses = courses.filter((course) => course.isFormation);
                courses = [
                    ...(data || []).map(mapCourse),
                    ...formationCourses
                ];
                renderQuestionCourseOptions();
                renderCourses();
                renderOverview();
                if (feedback) {
                    feedback.textContent = 'Le catalogue est à jour.';
                    feedback.hidden = false;
                }
            } catch (error) {
                console.error('Actualisation du catalogue impossible :', error);
                if (feedback) {
                    feedback.textContent = 'Impossible d’actualiser le catalogue. Réessayez.';
                    feedback.hidden = false;
                }
                alert('Impossible d’actualiser le catalogue. Vérifiez votre connexion et réessayez.');
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function actualiserQuestionsEtudiant() {
            const button = document.getElementById('refreshStudentQuestions');
            if (button) button.disabled = true;

            try {
                const client = window.supabaseClient;
                const student = readCurrentStudent();
                if (!client || !student) throw new Error('Session étudiant indisponible.');

                const { data, error } = await client.from('student_questions')
                    .select('id, course_title, question, response, status, created_at, responded_at')
                    .eq('student_id', student.id)
                    .order('created_at', { ascending: false });
                if (error) throw error;

                questions = data || [];
                renderQuestions();
            } catch (error) {
                console.error('Actualisation des questions impossible :', error);
                alert('Impossible d’actualiser vos questions. Vérifiez votre connexion et réessayez.');
            } finally {
                if (button) button.disabled = false;
            }
        }

        function renderOverview() {
            const courseCount = document.getElementById('studentCourseCount');
            const learningCount = document.getElementById('studentLearningCount');
            const pendingCount = document.getElementById('studentPendingCount');
            if (courseCount) courseCount.textContent = String(readCourses().length);
            if (learningCount) learningCount.textContent = String(readPurchases().length);
            if (pendingCount) {
                const exercisesToFollow = readPurchases().reduce((total, course) => {
                    return total + (course.exercises || []).filter((exercise) => {
                        const submission = getStudentSubmission(course.id, exercise.id || 'final');
                        return !submission || submission.status !== 'graded';
                    }).length;
                }, 0);
                pendingCount.textContent = String(exercisesToFollow);
            }
        }

        function openCourseResource(collection, index, type) {
            const items = collection === 'purchases' ? readPurchases() : readCourses();
            const course = items[index];
            const viewer = document.getElementById(`course-resource-${collection}-${index}`);

            if (!course || !viewer) return;
            if (course.isOpen === false) {
                alert('Ce cours est fermé par l’administration et ses ressources ne sont plus accessibles.');
                return;
            }

            const youtubeEmbedUrl = type === 'video' ? getYoutubeEmbedUrl(course.youtubeUrl) : '';
            const videoUrl = type === 'video' ? course.videoUrl : '';
            const resourceUrl = type === 'pdf' ? course.pdfUrl : '';
            let content = '';

            if (youtubeEmbedUrl) {
                content = `<iframe src="${youtubeEmbedUrl}" title="Vidéo du cours ${escapeHtml(course.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
            } else if (videoUrl) {
                content = `<video controls autoplay src="${escapeHtml(videoUrl)}">Votre navigateur ne peut pas lire cette vidéo.</video>`;
            } else if (resourceUrl) {
                content = `<iframe src="${escapeHtml(resourceUrl)}" title="Document PDF du cours ${escapeHtml(course.title)}"></iframe>`;
            } else {
                content = '<p class="resource-unavailable">Cette ressource est indisponible ou son format ne peut pas être affiché ici.</p>';
            }

            viewer.innerHTML = `
                <div class="course-resource-viewer">
                    <button class="course-resource-close" type="button" data-action="close-course-resource" data-collection="${collection}" data-index="${index}">Fermer</button>
                    ${content}
                </div>
            `;
            viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function closeCourseResource(collection, index) {
            const viewer = document.getElementById(`course-resource-${collection}-${index}`);
            if (viewer) viewer.innerHTML = '';
        }

        async function submitExercise(courseId, exerciseId, answer) {
            const student = readCurrentStudent();
            const role = String(student && student.role || '').trim().toLowerCase();
            if (!student || role !== 'student') {
                alert('Connectez-vous à votre compte étudiant pour envoyer votre exercice.');
                return;
            }

            const course = readPurchases().find((item) => String(item.id) === String(courseId));
            const exercise = course && (course.exercises || []).find((item) => String(item.id || 'final') === String(exerciseId));
            const response = String(answer || '').trim();

            if (!course || !exercise) {
                alert('Cours ou exercice introuvable. Actualisez la page et réessayez.');
                return;
            }
            if (course.isOpen === false) {
                alert('Ce cours est fermé par l’administration.');
                return;
            }
            if (!response) {
                alert('Écrivez votre réponse avant de l’envoyer.');
                return;
            }

            const existingSubmission = readExerciseSubmissions().find((submission) =>
                String(submission.courseId) === String(course.id) &&
                String(submission.exerciseId) === String(exercise.id || 'final')
            );

            if (existingSubmission?.status === 'graded') {
                alert('Cet exercice a déjà été corrigé. Consultez le résultat dans vos achats.');
                return;
            }
            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');
            const { data, error } = await client.rpc('submit_exercise_answer', {
                p_course_id: String(course.id),
                p_exercise_id: String(exercise.id || 'final'),
                p_answer: response
            });
            if (error) throw error;

            const submissionData = Array.isArray(data) ? data[0] : data;
            if (!submissionData) throw new Error('Supabase n’a pas retourné la réponse enregistrée.');
            const submission = mapSubmission(submissionData);
            const existingIndex = exerciseSubmissions.findIndex((item) =>
                String(item.courseId) === String(submission.courseId) &&
                String(item.exerciseId) === String(submission.exerciseId)
            );
            if (existingIndex >= 0) exerciseSubmissions[existingIndex] = submission;
            else exerciseSubmissions.unshift(submission);
            renderPurchases();
            renderOverview();
            alert(existingSubmission
                ? 'Votre réponse mise à jour a été envoyée au professeur.'
                : 'Votre réponse a été envoyée au professeur du cours.');
        }

        async function buyCourse(courseId) {
            const course = readCourses().find((item) => String(item.id) === String(courseId));
            if (!course) throw new Error('Cours introuvable.');
            if (course.isOpen === false) throw new Error('Ce cours est fermé par l’administration.');

            if (!readPurchases().some((item) => String(item.id) === String(courseId))) {
                const client = window.supabaseClient;
                if (!client) throw new Error('Client Supabase indisponible.');
                const student = readCurrentStudent();
                const { error } = await client.from('student_course_access').upsert({
                    student_id: student.id,
                    course_id: String(course.id)
                }, { onConflict: 'student_id,course_id' });
                if (error) throw error;
                purchases.unshift({ ...course, purchasedAt: new Date().toISOString() });
            }

            renderPurchases();
            renderOverview();
            showSection('my');
            alert('Cours ajouté à vos achats.');
        }

        async function chargerCatalogueFormations(formationId) {
            const container = document.getElementById('formationsDashboardContainer');
            const client = window.supabaseClient;
            if (!container || !client) return;
            container.textContent = 'Chargement des formations...';

            const { data: formations, error } = await client.from('formations').select('*');
            if (error) throw error;

            const playlists = window.ModalitePlaylist
                ? await window.ModalitePlaylist.load(formations || [], client)
                : new Map();
            (formations || []).forEach((formation) => {
                formation.playlist = playlists.get(String(formation.id)) || { courses: [], lessons: [] };
            });

            formationsCatalogue.clear();
            (formations || []).forEach((formation) => {
                formationsCatalogue.set(String(formation.id), formation);
            });

            container.replaceChildren();
            if (!formations?.length) {
                container.innerHTML = '<div class="empty-state">Aucune formation disponible pour le moment.</div>';
                return;
            }

            const groupes = new Map();
            formations.forEach((formation) => {
                const categorie = formation.categorie || 'Autres cours';
                if (!groupes.has(categorie)) groupes.set(categorie, []);
                groupes.get(categorie).push(formation);
            });
            [...groupes.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr')).forEach(([categorie, items]) => {
                const section = document.createElement('details');
                section.className = 'dashboard-formation-group modalite-group';
                const titreCategorie = document.createElement('summary');
                titreCategorie.textContent = categorie;
                section.appendChild(titreCategorie);
                const grille = document.createElement('div');
                grille.className = 'dashboard-formations-grid modalite-group-content';

                items.forEach((formation) => {
                    const titre = formation.title || formation.titre || 'Formation';
                    const isOpen = formation.is_open !== false;
                    const carte = document.createElement('article');
                    carte.className = `dashboard-formation-card modalite-formation${isOpen ? '' : ' is-closed'}`;
                    carte.dataset.search = [titre, categorie, formation.description || ''].join(' ').toLocaleLowerCase('fr');
                    if (formation.couverture_url) {
                        const image = document.createElement('img');
                        image.src = formation.couverture_url;
                        image.alt = `Couverture : ${titre}`;
                        image.loading = 'lazy';
                        carte.appendChild(image);
                    }
                    const titreCours = document.createElement('h4');
                    titreCours.textContent = titre;
                    carte.appendChild(titreCours);
                    if (!isOpen) {
                        const status = document.createElement('p');
                        status.className = 'closed-course-notice';
                        status.textContent = 'Fermée par l’administration';
                        carte.appendChild(status);
                    }
                    if (formation.description) {
                        const blocDescription = document.createElement('div');
                        blocDescription.className = 'dashboard-formation-description';
                        const description = document.createElement('p');
                        description.className = 'dashboard-formation-description-text';
                        description.textContent = formation.description;
                        const navigation = document.createElement('div');
                        navigation.className = 'dashboard-formation-description-navigation';
                        navigation.setAttribute('role', 'group');
                        navigation.setAttribute('aria-label', 'Navigation dans la description');
                        const precedent = document.createElement('button');
                        precedent.type = 'button';
                        precedent.className = 'dashboard-formation-description-button dashboard-formation-description-previous';
                        precedent.textContent = 'Précédent';
                        precedent.hidden = true;
                        const suivant = document.createElement('button');
                        suivant.type = 'button';
                        suivant.className = 'dashboard-formation-description-button dashboard-formation-description-next';
                        suivant.textContent = 'Suivant';
                        navigation.append(precedent, suivant);
                        blocDescription.append(description, navigation);
                        carte.appendChild(blocDescription);
                        initialiserNavigationDescription(blocDescription);
                    }
                    if (window.ModalitePlaylist) {
                        const playlist = document.createElement('div');
                        playlist.innerHTML = window.ModalitePlaylist.render(formation, { student: true });
                        carte.appendChild(playlist);
                    }
                    const prix = document.createElement('p');
                    prix.className = 'dashboard-formation-price';
                    prix.textContent = `${Number(formation.prix || 0).toLocaleString('fr-FR')} FCFA`;
                    carte.appendChild(prix);
                    const action = document.createElement('button');
                    action.type = 'button';
                    action.className = 'buy-btn';
                    action.dataset.action = 'open-formation';
                    action.dataset.formationId = String(formation.id);
                    action.textContent = 'Accéder à la formation';
                    action.disabled = !isOpen;
                    carte.appendChild(action);
                    grille.appendChild(carte);
                });

                section.appendChild(grille);
                container.appendChild(section);
            });
            requestAnimationFrame(actualiserToutesNavigationsDescriptions);
            if (formationId) await ouvrirFormation(formationId);
        }

        async function ouvrirFormation(formationId, lessonId = null) {
            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');
            const { data, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            const utilisateur = data?.user;
            if (!utilisateur) {
                window.location.href = `login.html?formation=${encodeURIComponent(formationId)}`;
                return;
            }

            const formation = formationsCatalogue.get(String(formationId));
            if (!formation) throw new Error('Formation introuvable dans le catalogue.');
            if (formation.is_open === false) throw new Error('Cette formation est fermée par l’administration.');

            const { error } = await client.from('student_formation_access').upsert({
                student_id: utilisateur.id,
                formation_id: String(formationId)
            }, { onConflict: 'student_id,formation_id' });
            if (error) throw error;

            const destination = new URL('parcours-formation.html', window.location.href);
            destination.searchParams.set('formation', String(formationId));
            if (lessonId) destination.searchParams.set('lesson', String(lessonId));
            window.location.href = destination.href;
        }

        function filtrerCatalogueFormations() {
            const input = document.getElementById('recherche-formations-dashboard');
            if (!input) return;
            const terme = input.value.trim().toLocaleLowerCase('fr');
            document.querySelectorAll('.dashboard-formation-group').forEach((section) => {
                let visible = false;
                section.querySelectorAll('.dashboard-formation-card').forEach((carte) => {
                    const correspond = carte.dataset.search.includes(terme);
                    carte.hidden = !correspond;
                    visible ||= correspond;
                });
                section.hidden = !visible;
            });
        }

        function renderPurchases() {
            const purchases = readPurchases();
            const container = document.getElementById('purchasesContainer');

            if (!container) return;

            if (!purchases.length) {
                container.innerHTML = '<div class="empty-state">Vous n’avez pas encore ouvert de formation. Choisissez « Accéder à la formation » dans le catalogue.</div>';
                return;
            }

            container.innerHTML = purchases.map((purchase) => {
                const purchaseIndex = purchases.indexOf(purchase);
                const isOpen = purchase.isOpen !== false;
                const priceHtml = purchase.formationType
                    ? ''
                    : `<p><strong>Prix :</strong> ${Number(purchase.price || 0).toLocaleString('fr-FR')} FCFA</p>`;
                const learningPathButton = purchase.formationType
                    ? `<button class="buy-btn" type="button" ${isOpen ? `data-action="start-formation" data-formation-id="${escapeHtml(purchase.id)}"` : 'disabled'}>Continuer le parcours</button>`
                    : '';
                const thumbnailHtml = purchase.thumbnail
                    ? `<img class="purchase-thumbnail" src="${escapeHtml(purchase.thumbnail)}" alt="Couverture : ${escapeHtml(purchase.title)}">`
                    : '';
                const categoryHtml = purchase.category
                    ? `<p><strong>Catégorie :</strong> ${escapeHtml(purchase.category)}</p>`
                    : '';
                const descriptionHtml = purchase.description
                    ? `<p>${escapeHtml(purchase.description)}</p>`
                    : '';
                const exercises = purchase.exercises || [];
                const submittedExercises = exercises.filter((exercise) =>
                    getStudentSubmission(purchase.id, exercise.id || 'final')
                ).length;
                const progressHtml = exercises.length
                    ? `<div class="course-progress"><span>Exercices remis</span><strong>${submittedExercises}/${exercises.length}</strong><progress max="${exercises.length}" value="${submittedExercises}" aria-label="Progression des exercices"></progress></div>`
                    : '';
                const pdfButton = purchase.pdfUrl ? `<button type="button" class="link-btn" data-action="open-course-resource" data-collection="purchases" data-index="${purchaseIndex}" data-type="pdf">Voir le PDF</button>` : '';
                const videoButton = purchase.youtubeUrl || purchase.videoUrl ? `<button type="button" class="link-btn" data-action="open-course-resource" data-collection="purchases" data-index="${purchaseIndex}" data-type="video">Voir la vidéo</button>` : '';
                const exercisesList = isOpen ? (purchase.exercises || []).map((exercise) => {
                    const exerciseId = exercise.id || 'final';
                    const submission = getStudentSubmission(purchase.id, exerciseId);
                    const maxScore = Number(exercise.maxScore || 20);
                    const feedbackHtml = submission
                        ? submission.status === 'graded'
                            ? `<div class="submission-result"><strong>Résultat : ${Number(submission.grade)}/${maxScore}</strong>${submission.feedback ? `<p>${escapeHtml(submission.feedback)}</p>` : ''}<small>Corrigé le ${new Date(submission.gradedAt).toLocaleString('fr-FR')}</small></div>`
                            : `<div class="submission-result pending"><strong>Réponse envoyée</strong><p>En attente de correction par ${escapeHtml(purchase.teacher || 'le professeur')}.</p><small>Envoyée le ${new Date(submission.submittedAt).toLocaleString('fr-FR')}</small></div>`
                        : '';
                    const answerForm = submission && submission.status === 'graded'
                        ? ''
                        : `<form class="exercise-submission-form" data-course-id="${escapeHtml(purchase.id)}" data-exercise-id="${escapeHtml(exerciseId)}"><label for="answer-${escapeHtml(purchase.id)}-${escapeHtml(exerciseId)}">Votre réponse</label><textarea id="answer-${escapeHtml(purchase.id)}-${escapeHtml(exerciseId)}" name="answer" required placeholder="Rédigez votre réponse ou expliquez votre démarche.">${submission ? escapeHtml(submission.answer) : ''}</textarea><button class="link-btn" type="submit">${submission ? 'Renvoyer ma réponse' : 'Envoyer au professeur'}</button></form>`;
                    return `
                        <div class="exercise-card">
                            <strong>Exercice pratique</strong>
                            <p>${escapeHtml(exercise.text)}</p>
                            <small>Note maximale : ${maxScore}/20</small>
                            ${feedbackHtml}
                            ${answerForm}
                        </div>
                    `;
                }).join('') : '';
                const certificateButton = isOpen && coursePassedForStudent(purchase)
                    ? `<button class="link-btn" type="button" data-action="download-certificate" data-index="${purchaseIndex}">Télécharger mon attestation</button>`
                    : '';

                return `
                    <div class="purchase-card ${isOpen ? '' : 'is-closed'}" id="formation-${escapeHtml(purchase.id)}">
                        ${isOpen ? '' : '<p class="closed-course-notice">Accès suspendu : ce cours est fermé par l’administration.</p>'}
                        ${thumbnailHtml}
                        <h3>${escapeHtml(purchase.title)}</h3>
                        ${categoryHtml}
                        ${descriptionHtml}
                        <p><strong>Professeur :</strong> ${escapeHtml(purchase.teacher)}</p>
                        ${priceHtml}
                        ${learningPathButton}
                        ${isOpen ? progressHtml : ''}
                        ${exercisesList}
                        ${isOpen ? videoButton : ''}
                        ${isOpen ? pdfButton : ''}
                        ${certificateButton}
                        <div id="course-resource-purchases-${purchaseIndex}"></div>
                    </div>
                `;
            }).join('');
        }

        async function downloadCourseCertificate(purchaseIndex) {
            const course = readPurchases()[purchaseIndex];
            if (!course || !coursePassedForStudent(course)) {
                alert('L’attestation sera disponible après validation de tous les exercices par le professeur.');
                return;
            }

            try {
                await generateCourseCertificate(course);
            } catch (error) {
                console.error('Génération de l’attestation échouée :', error);
                alert('Impossible de générer l’attestation. Réessayez plus tard.');
            }
        }

        async function sendQuestion() {
            const selectedCourseId = document.getElementById('questionCourse').value;
            const message = document.getElementById('questionText').value.trim();

            if (!selectedCourseId || !message) {
                alert('Choisissez un cours et écrivez votre question.');
                return;
            }

            const student = readCurrentStudent();
            if (!student) throw new Error('Session étudiant indisponible.');
            const matchedCourse = selectedCourseId === '__admin__'
                ? null
                : readCourses().find((item) => String(item.id) === selectedCourseId);
            if (selectedCourseId !== '__admin__' && !matchedCourse) {
                throw new Error('Le cours sélectionné est introuvable. Actualisez le catalogue.');
            }
            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');
            const { data, error } = await client.from('student_questions').insert({
                student_id: student.id,
                teacher_id: matchedCourse?.teacherId || null,
                course_id: matchedCourse ? String(matchedCourse.id) : null,
                course_title: matchedCourse?.title || 'Question générale à l’administration',
                question: message
            }).select('id, course_title, question, response, status, created_at, responded_at').single();
            if (error) throw error;

            questions.unshift(data);
            document.getElementById('questionCourse').value = '';
            document.getElementById('questionText').value = '';
            renderQuestions();
            alert('Question envoyée avec succès.');
        }

        function renderQuestions() {
            const container = document.getElementById('questionsContainer');

            if (!container) return;

            if (!questions.length) {
                container.innerHTML = '<div class="empty-state">Aucune question pour le moment.</div>';
                return;
            }

            container.innerHTML = questions.map((item) => `
                <div class="purchase-card">
                    <h3>${escapeHtml(item.course_title)}</h3>
                    <small class="question-status ${item.response ? 'is-answered' : 'is-pending'}">${item.response ? 'Réponse reçue' : 'En attente de réponse'}</small>
                    <p>${escapeHtml(item.question)}</p>
                    ${item.response ? `<p><strong>Réponse :</strong> ${escapeHtml(item.response)}</p><small>Répondu le ${new Date(item.responded_at || item.created_at).toLocaleString('fr-FR')}</small>` : ''}
                    <small>${new Date(item.created_at).toLocaleString('fr-FR')}</small>
                </div>
            `).join('');
        }


        document.addEventListener('DOMContentLoaded', async function () {
            document.addEventListener('click', (event) => {
                const playlistLink = event.target.closest('[data-playlist-formation]');
                if (playlistLink) {
                    event.preventDefault();
                    ouvrirFormation(playlistLink.dataset.playlistFormation, playlistLink.dataset.playlistLesson)
                        .catch((error) => {
                            console.error('Ouverture de la leçon impossible :', error);
                            alert(error.message || 'Impossible d’ouvrir cette leçon.');
                        });
                    return;
                }
                const actionButton = event.target.closest('[data-action]');
                if (!actionButton) return;

                const index = Number(actionButton.dataset.index);
                switch (actionButton.dataset.action) {
                    case 'logout':
                        logout(event);
                        break;
                    case 'send-question':
                        sendQuestion().catch((error) => {
                            console.error('Envoi de la question impossible :', error);
                            alert('Impossible d’envoyer la question. Vérifie ta connexion et réessaie.');
                        });
                        break;
                    case 'start-formation':
                        window.location.href = `parcours-formation.html?formation=${encodeURIComponent(actionButton.dataset.formationId)}`;
                        break;
                    case 'buy-course':
                        buyCourse(actionButton.dataset.courseId).catch((error) => {
                            console.error('Accès au cours impossible :', error);
                            alert('Impossible d’ajouter ce cours à vos accès. Réessayez.');
                        });
                        break;
                    case 'open-formation':
                        ouvrirFormation(actionButton.dataset.formationId)
                            .catch((error) => {
                                console.error('Ouverture de la formation impossible :', error);
                                alert('Impossible d’ouvrir cette formation. Vérifie ta connexion et réessaie.');
                            });
                        break;
                    case 'open-course-resource':
                        openCourseResource(actionButton.dataset.collection, index, actionButton.dataset.type);
                        break;
                    case 'close-course-resource':
                        closeCourseResource(actionButton.dataset.collection, index);
                        break;
                    case 'download-certificate':
                        downloadCourseCertificate(index);
                        break;
                }
            });

            document.querySelectorAll('.nav-btn, .welcome-btn').forEach((button) => {
                button.addEventListener('click', function () {
                    showSection(button.dataset.target);
                });
            });

            document.getElementById('courseSearch')
                ?.addEventListener('input', filtrerCatalogueCours);
            document.getElementById('refreshCourseCatalog')
                ?.addEventListener('click', actualiserCatalogueCours);
            document.getElementById('refreshStudentQuestions')
                ?.addEventListener('click', actualiserQuestionsEtudiant);
            document.getElementById('recherche-formations-dashboard')
                ?.addEventListener('input', filtrerCatalogueFormations);

            document.addEventListener('submit', (event) => {
                const form = event.target.closest('.exercise-submission-form');
                if (!form) return;
                event.preventDefault();
                submitExercise(form.dataset.courseId, form.dataset.exerciseId, new FormData(form).get('answer'))
                    .catch((error) => {
                        console.error('Envoi de l’exercice impossible :', error);
                        alert('Impossible d’envoyer votre réponse. Vérifiez la connexion et réessayez.');
                    });
            });

            try {
                const loaded = await loadStudentData();
                if (!loaded) return;

                renderCourses();
                renderPurchases();
                renderOverview();
                renderQuestions();

                const params = new URLSearchParams(window.location.search);
                const formationId = params.get('formation');
                await chargerCatalogueFormations(formationId);
                if (!formationId && params.get('section') === 'my') {
                    showSection('my');
                }
            } catch (error) {
                console.error('Chargement du tableau étudiant impossible :', error);
                alert(error.message || 'Impossible de charger les données du compte étudiant.');
                const container = document.getElementById('formationsDashboardContainer');
                if (container) {
                    container.innerHTML = '<div class="empty-state">Impossible de charger les données. Vérifiez la configuration Supabase.</div>';
                }
                const coursesContainer = document.getElementById('coursesContainer');
                if (coursesContainer) {
                    coursesContainer.innerHTML = '<div class="empty-state">Impossible de charger le catalogue. Actualisez la page ou réessayez plus tard.</div>';
                }
            }
        });
