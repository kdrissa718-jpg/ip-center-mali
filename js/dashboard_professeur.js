async function logout(event) {
    if (event) event.preventDefault();
    try {
        await window.supabaseClient?.auth.signOut();
    } finally {
        window.location.replace('login.html');
    }
}

        let currentTeacher = null;
        let courses = [];
        let submissions = [];
        let studentQuestions = [];

        function readCurrentTeacher() {
            return currentTeacher;
        }

        function readSubmissions() {
            return submissions;
        }

        function readCourses() {
            return courses;
        }

        function mapCourse(row) {
            return {
                id: row.id,
                formationId: row.formation_id || '',
                category: row.categorie || '',
                title: row.title || 'Cours',
                description: row.description || '',
                teacher: row.teacher || currentTeacher?.name || 'Professeur',
                teacherId: row.professor_id,
                teacherEmail: row.teacher_email || currentTeacher?.email || '',
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

        async function loadTeacherData() {
            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');

            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData?.user) {
                window.location.replace('login.html');
                return false;
            }

            const user = authData.user;
            const { data: profile, error: profileError } = await client.from('profiles')
                .select('full_name, role, status')
                .eq('id', user.id)
                .maybeSingle();
            if (profileError) throw profileError;
            if (profile?.status === 'Bloqué') {
                await client.auth.signOut();
                throw new Error('Ce compte professeur est bloqué.');
            }
            if (profile?.role !== 'teacher') {
                throw new Error('Ce compte ne possède pas le rôle professeur.');
            }

            currentTeacher = {
                id: user.id,
                email: user.email || '',
                name: profile.full_name || user.user_metadata?.nom || user.email || 'Professeur',
                role: profile.role
            };
            const welcomeName = document.getElementById('teacherWelcomeName');
            if (welcomeName) welcomeName.textContent = currentTeacher.name;

            const [courseResult, submissionResult, questionResult] = await Promise.all([
                client.from('cours')
                    .select('id, formation_id, categorie, title, description, professor_id, teacher, teacher_email, price, thumbnail_url, youtube_url, video_url, pdf_url, exercises, created_at, is_open')
                    .eq('professor_id', user.id)
                    .order('created_at', { ascending: false }),
                client.from('exercise_submissions')
                    .select('*')
                    .eq('teacher_id', user.id)
                    .order('submitted_at', { ascending: false }),
                client.from('student_questions')
                    .select('id, student_id, teacher_id, course_id, course_title, question, response, status, created_at, responded_at')
                    .eq('teacher_id', user.id)
                    .order('created_at', { ascending: false })
            ]);
            if (courseResult.error) throw courseResult.error;
            if (submissionResult.error) throw submissionResult.error;
            if (questionResult.error) throw questionResult.error;

            courses = (courseResult.data || []).map(mapCourse);
            const formationIds = [...new Set(courses.map((course) => course.formationId).filter(Boolean).map(String))];
            if (formationIds.length && window.ModalitePlaylist) {
                const { data: linkedFormations, error: formationError } = await client.from('formations')
                    .select('id, title, categorie, is_open, video_url, youtube_url')
                    .in('id', formationIds);
                if (formationError) throw formationError;
                const playlists = await window.ModalitePlaylist.load(linkedFormations || [], client);
                courses.forEach((course) => {
                    const formation = (linkedFormations || []).find((item) => String(item.id) === String(course.formationId));
                    if (formation) course.modality = {
                        ...formation,
                        playlist: playlists.get(String(formation.id)) || { courses: [], lessons: [] }
                    };
                });
            }
            submissions = (submissionResult.data || []).map(mapSubmission);
            studentQuestions = questionResult.data || [];
            return true;
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

        function isCourseOwnedByCurrentTeacher(course, teacher) {
            const role = String(teacher && teacher.role || '').trim().toLowerCase();
            if (!teacher || !['teacher', 'professeur', 'prof'].includes(role)) return false;

            const teacherId = String(teacher.id || '');
            const teacherEmail = String(teacher.email || '').trim().toLowerCase();
            const courseTeacherId = String(course.teacherId || '');
            const courseTeacherEmail = String(course.teacherEmail || '').trim().toLowerCase();

            if (courseTeacherId || courseTeacherEmail) {
                return Boolean(
                    (courseTeacherId && teacherId && courseTeacherId === teacherId) ||
                    (courseTeacherEmail && teacherEmail && courseTeacherEmail === teacherEmail)
                );
            }

            return String(course.teacher || '').trim().toLocaleLowerCase() ===
                String(teacher.name || '').trim().toLocaleLowerCase();
        }

        function readCurrentTeacherCourses() {
            return readCurrentTeacher() ? readCourses() : [];
        }

        async function uploadCourseFile(file, folder) {
            if (!file) return null;
            const client = window.supabaseClient;
            const teacher = readCurrentTeacher();
            if (!client || !teacher) throw new Error('Session professeur indisponible.');

            const extension = file.name.includes('.')
                ? file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '')
                : 'bin';
            const path = `${teacher.id}/${Date.now()}-${folder}.${extension}`;
            const { error } = await client.storage.from('course-files').upload(path, file, {
                contentType: file.type || 'application/octet-stream',
                upsert: false
            });
            if (error) throw error;

            const { data } = client.storage.from('course-files').getPublicUrl(path);
            return { path, url: data.publicUrl };
        }

        function normalizeYoutubeEmbed(url) {
            if (!url) return '';
            const value = String(url).trim();
            const match = value.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
            if (!match) return value;
            return 'https://www.youtube.com/watch?v=' + match[1];
        }

        function getYoutubeThumbnail(url) {
            if (!url) return '';
            const match = String(url).match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
            if (!match) return '';
            return 'https://img.youtube.com/vi/' + match[1] + '/hqdefault.jpg';
        }

        function showSection(key) {
            document.querySelectorAll('.nav-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.target === key);
            });
            document.querySelectorAll('.panel').forEach((panel) => {
                panel.classList.toggle('active', panel.id === key);
            });
        }

        function renderCourses() {
            const courses = readCurrentTeacherCourses();
            const container = document.getElementById('teacherCourses');

            if (!container) return;

            if (!courses.length) {
                container.innerHTML = '<div class="empty-state">Aucun cours associé à ce compte professeur. Connectez-vous avec le compte qui a publié les cours.</div>';
                return;
            }

            container.innerHTML = courses.map((course) => {
                const youtubeThumbnail = getYoutubeThumbnail(course.youtubeUrl);
                const youtubeHtml = course.youtubeUrl ? `
                    <a href="${escapeHtml(course.youtubeUrl)}" target="_blank" rel="noopener noreferrer">
                        <img src="${youtubeThumbnail || 'https://img.youtube.com/vi/aqz-KE-bpKQ/hqdefault.jpg'}" alt="${escapeHtml(course.title)}">
                    </a>
                ` : '';
                const videoHtml = !course.youtubeUrl && course.videoUrl ? `<video controls src="${course.videoUrl}"></video>` : '';
                const imageHtml = !course.youtubeUrl && course.thumbnail ? `<img src="${course.thumbnail}" alt="${escapeHtml(course.title)}">` : '';
                const pdfHtml = course.pdfUrl ? `<a class="link-btn" href="${course.pdfUrl}" target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>` : '';

                const exercisesHtml = (course.exercises || []).map((exercise) => `
                    <div class="exercise-card">
                        <strong>Exercice pratique</strong>
                        <p>${escapeHtml(exercise.text)}</p>
                        <small>Note maximale : ${Number(exercise.maxScore || 20)}/20</small>
                    </div>
                `).join('');

                return `
                    <article class="course-card">
                        ${course.isOpen ? '' : '<span class="course-closed-notice">Fermé aux étudiants par l’administration</span>'}
                        ${imageHtml || youtubeHtml || videoHtml || '<div class="empty-state">Aucune ressource média</div>'}
                        <h3>${escapeHtml(course.title)}</h3>
                        ${course.category ? `<p class="course-category"><strong>Catégorie :</strong> ${escapeHtml(course.category)}</p>` : ''}
                        ${course.modality && window.ModalitePlaylist ? window.ModalitePlaylist.render(course.modality, { student: false, showClosedContent: true }) : ''}
                        <p>${escapeHtml(course.description)}</p>
                        <div class="meta">
                            <span>${escapeHtml(course.teacher)}</span>
                            <strong>${Number(course.price || 0).toLocaleString('fr-FR')} FCFA</strong>
                        </div>
                        ${exercisesHtml}
                        ${pdfHtml}
                    </article>
                `;
            }).join('');
        }

        function renderStats() {
            const courses = readCurrentTeacherCourses();
            const courseIds = new Set(courses.map((course) => String(course.id)));
            const pendingReviews = readSubmissions().filter((submission) =>
                courseIds.has(String(submission.courseId)) && submission.status !== 'graded'
            ).length;
            const videoCount = courses.filter((course) => course.youtubeUrl || course.videoUrl).length;

            document.getElementById('statCoursesCount').textContent = String(courses.length);
            document.getElementById('statPendingReviews').textContent = String(pendingReviews);
            document.getElementById('statVideoCount').textContent = String(videoCount);
        }

        function setTeacherNotice(message, isError) {
            const notice = document.getElementById('teacherNotice');
            if (!notice) return;
            notice.textContent = message;
            notice.classList.toggle('is-error', Boolean(isError));
            notice.hidden = !message;
        }

        function renderSubmissions() {
            const container = document.getElementById('submissionsContainer');
            const courses = readCurrentTeacherCourses();
            const courseIds = new Set(courses.map((course) => String(course.id)));
            const submissions = readSubmissions().filter((submission) => courseIds.has(String(submission.courseId)));

            if (!container) return;
            if (!readCurrentTeacher()) {
                container.innerHTML = '<div class="empty-state">Connectez-vous avec le compte professeur concerné pour consulter les réponses.</div>';
                return;
            }
            if (!submissions.length) {
                container.innerHTML = '<div class="empty-state">Aucune réponse reçue pour vos cours pour le moment.</div>';
                return;
            }

            container.innerHTML = submissions.map((submission) => {
                const maxScore = Number(submission.maxScore || 20);
                const graded = submission.status === 'graded';
                return `
                    <article class="submission-card">
                        <h3>${escapeHtml(submission.courseTitle || 'Cours')}</h3>
                        <p><strong>Étudiant :</strong> ${escapeHtml(submission.studentName || 'Étudiant')} (${escapeHtml(submission.studentEmail || 'email non renseigné')})</p>
                        <p><strong>Exercice :</strong> ${escapeHtml(submission.exerciseText || 'Exercice pratique')}</p>
                        <p><strong>Réponse reçue le :</strong> ${new Date(submission.submittedAt).toLocaleString('fr-FR')}</p>
                        <div class="submission-answer">${escapeHtml(submission.answer)}</div>
                        ${graded
                            ? `<div class="grading-result"><strong>Résultat envoyé : ${Number(submission.grade)}/${maxScore}</strong>${submission.feedback ? `<p>${escapeHtml(submission.feedback)}</p>` : ''}<small>Corrigé le ${new Date(submission.gradedAt).toLocaleString('fr-FR')}</small></div>`
                            : `<form class="grading-form" data-submission-id="${escapeHtml(submission.id)}"><label>Note / ${maxScore}<input name="grade" type="number" min="0" max="${maxScore}" step="0.5" required placeholder="Saisir la note"></label><label>Commentaire pour l’étudiant<textarea name="feedback" placeholder="Expliquez les points réussis et les améliorations attendues."></textarea></label><button class="primary-btn" type="submit">Envoyer le résultat à l’étudiant</button></form>`
                        }
                    </article>
                `;
            }).join('');
        }

        function renderStudentQuestions() {
            const container = document.getElementById('teacherQuestionsContainer');
            if (!container) return;
            if (!readCurrentTeacher()) {
                container.innerHTML = '<div class="empty-state">Connectez-vous avec le compte professeur concerné pour consulter les questions.</div>';
                return;
            }
            if (!studentQuestions.length) {
                container.innerHTML = '<div class="empty-state">Aucune question reçue pour vos cours.</div>';
                return;
            }

            container.innerHTML = studentQuestions.map((question) => `
                <article class="submission-card question-card">
                    <span class="question-status ${question.response ? 'is-answered' : 'is-pending'}">
                        ${question.response ? 'Répondue' : 'En attente'}
                    </span>
                    <h3>${escapeHtml(question.course_title || 'Cours')}</h3>
                    <p><strong>Étudiant :</strong> ${escapeHtml(String(question.student_id || '').slice(0, 8) || 'Compte étudiant')}</p>
                    <p><strong>Question reçue le :</strong> ${new Date(question.created_at).toLocaleString('fr-FR')}</p>
                    <div class="submission-answer">${escapeHtml(question.question)}</div>
                    ${question.response
                        ? `<div class="grading-result"><strong>Votre réponse</strong><p>${escapeHtml(question.response)}</p><small>Envoyée le ${new Date(question.responded_at || question.created_at).toLocaleString('fr-FR')}</small></div>`
                        : `<form class="question-response-form" data-question-id="${escapeHtml(question.id)}"><label>Votre réponse<textarea name="response" required maxlength="5000" placeholder="Rédigez une réponse à transmettre à l’étudiant."></textarea></label><button class="primary-btn" type="submit">Envoyer au dashboard étudiant</button></form>`
                    }
                </article>
            `).join('');
        }

        async function actualiserQuestionsProfesseur() {
            const button = document.getElementById('refreshTeacherQuestions');
            if (button) button.disabled = true;
            try {
                const teacher = readCurrentTeacher();
                const client = window.supabaseClient;
                if (!teacher || !client) throw new Error('Session professeur indisponible.');
                const { data, error } = await client.from('student_questions')
                    .select('id, student_id, teacher_id, course_id, course_title, question, response, status, created_at, responded_at')
                    .eq('teacher_id', teacher.id)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                studentQuestions = data || [];
                renderStudentQuestions();
            } catch (error) {
                console.error('Chargement des questions étudiantes impossible :', error);
                alert('Impossible d’actualiser les questions. Vérifiez votre connexion et réessayez.');
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function respondToStudentQuestion(questionId, responseValue) {
            const teacher = readCurrentTeacher();
            const question = studentQuestions.find((item) => String(item.id) === String(questionId));
            const response = String(responseValue || '').trim();
            if (!teacher || !question || String(question.teacher_id || '') !== String(teacher.id)) {
                throw new Error('Cette question ne vous est pas attribuée.');
            }
            if (!response) {
                alert('Écrivez votre réponse avant de l’envoyer.');
                return;
            }

            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');
            const { data, error } = await client.from('student_questions')
                .update({ response, status: 'Répondue', responded_at: new Date().toISOString() })
                .eq('id', question.id)
                .eq('teacher_id', teacher.id)
                .select('id, student_id, teacher_id, course_id, course_title, question, response, status, created_at, responded_at')
                .single();
            if (error) throw error;

            const index = studentQuestions.findIndex((item) => String(item.id) === String(question.id));
            studentQuestions[index] = data;
            renderStudentQuestions();
            alert('Votre réponse a été envoyée dans le dashboard de l’étudiant.');
        }

        async function gradeSubmission(submissionId, gradeValue, feedbackValue) {
            const teacher = readCurrentTeacher();
            const submission = submissions.find((item) => String(item.id) === String(submissionId));
            const course = submission && courses.find((item) => String(item.id) === String(submission.courseId));

            if (!teacher || !submission || !course || !isCourseOwnedByCurrentTeacher(course, teacher)) {
                alert('Cette réponse ne correspond pas à un cours de votre compte.');
                return;
            }

            const grade = Number(gradeValue);
            const maxScore = Number(submission.maxScore || 20);
            if (!Number.isFinite(grade) || grade < 0 || grade > maxScore) {
                alert(`La note doit être comprise entre 0 et ${maxScore}.`);
                return;
            }

            const client = window.supabaseClient;
            if (!client) throw new Error('Client Supabase indisponible.');
            const { data, error } = await client.from('exercise_submissions')
                .update({
                    grade,
                    feedback: String(feedbackValue || '').trim(),
                    status: 'graded',
                    graded_at: new Date().toISOString(),
                    grader_id: teacher.id
                })
                .eq('id', submission.id)
                .eq('teacher_id', teacher.id)
                .eq('status', 'pending')
                .select('*')
                .single();
            if (error) throw error;

            const index = submissions.findIndex((item) => String(item.id) === String(submission.id));
            submissions[index] = mapSubmission(data);
            renderSubmissions();
            renderStats();
            alert('La correction a été envoyée à l’étudiant.');
        }

        async function handleSubmit(event) {
            event.preventDefault();

            const title = document.getElementById('title').value.trim();
            const category = document.getElementById('courseCategory').value.trim();
            const description = document.getElementById('description').value.trim();
            const teacher = document.getElementById('teacher').value.trim();
            const priceValue = document.getElementById('price').value.trim();
            const price = Number(priceValue);
            const exerciseText = document.getElementById('exerciseText').value.trim();
            const exerciseScore = Number(document.getElementById('exerciseScore').value || 20);
            const youtubeUrl = normalizeYoutubeEmbed(document.getElementById('youtubeUrl').value);
            const imageFile = document.getElementById('courseImage').files[0];
            const videoFile = document.getElementById('courseVideo').files[0];
            const pdfFile = document.getElementById('coursePdf').files[0];

            if (!title || !category || !description || !teacher || !priceValue || !Number.isFinite(price) || price < 0) {
                alert('Veuillez remplir les champs requis et saisir un prix valide.');
                return;
            }

            if (!imageFile && !youtubeUrl && !videoFile && !pdfFile && !exerciseText) {
                alert('Ajoutez au moins une ressource : image, vidéo, lien YouTube, PDF ou un exercice pratique.');
                return;
            }

            const uploadedFiles = [];
            let courseSaved = false;
            const submitButton = document.querySelector('#courseForm button[type="submit"]');
            const originalButtonText = submitButton?.textContent || '';
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Publication en cours...';
            }
            setTeacherNotice('Téléversement des ressources et publication du cours...');
            try {
                const client = window.supabaseClient;
                const teacherAccount = readCurrentTeacher();
                if (!client || !teacherAccount) throw new Error('Session professeur indisponible.');

                const thumbnailUpload = await uploadCourseFile(imageFile, 'image');
                if (thumbnailUpload) uploadedFiles.push(thumbnailUpload.path);
                const videoUpload = await uploadCourseFile(videoFile, 'video');
                if (videoUpload) uploadedFiles.push(videoUpload.path);
                const pdfUpload = await uploadCourseFile(pdfFile, 'pdf');
                if (pdfUpload) uploadedFiles.push(pdfUpload.path);

                const courseData = {
                    title,
                    categorie: category,
                    description,
                    professor_id: teacherAccount.id,
                    teacher: teacherAccount.name,
                    teacher_email: teacherAccount.email,
                    status: 'Publié',
                    price,
                    thumbnail_url: thumbnailUpload?.url || null,
                    youtube_url: youtubeUrl || null,
                    video_url: videoUpload?.url || null,
                    pdf_url: pdfUpload?.url || null,
                    exercises: exerciseText ? [{
                        id: Date.now() + '-exercise',
                        title: 'Exercice pratique final',
                        text: exerciseText,
                        maxScore: Math.min(20, Math.max(1, exerciseScore || 20))
                    }] : []
                };

                const { data, error } = await client.from('cours')
                    .insert(courseData)
                    .select('id, formation_id, categorie, title, description, professor_id, teacher, teacher_email, price, thumbnail_url, youtube_url, video_url, pdf_url, exercises, status, created_at')
                    .single();
                if (error) throw error;
                courseSaved = true;

                courses.unshift(mapCourse(data));
                renderCourses();
                renderStats();
                document.getElementById('courseForm').reset();
                document.getElementById('teacher').value = teacherAccount.name;
                showSection('my');
                setTeacherNotice('Votre cours a été publié avec succès.');
                alert('Cours publié avec succès.');
            } catch (error) {
                if (uploadedFiles.length && !courseSaved && window.supabaseClient) {
                    const { error: cleanupError } = await window.supabaseClient
                        .storage.from('course-files').remove(uploadedFiles);
                    if (cleanupError) {
                        console.error('Nettoyage des fichiers téléversés impossible :', cleanupError);
                    }
                }
                console.error('Enregistrement du cours impossible :', error);
                setTeacherNotice(error.message || 'Impossible de publier le cours. Vérifiez votre connexion et réessayez.', true);
                alert('Une erreur est survenue lors de l\'enregistrement du cours.');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText;
                }
            }
        }

        document.addEventListener('DOMContentLoaded', async function () {
            document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);

            document.querySelectorAll('.nav-btn, .welcome-btn').forEach((button) => {
                button.addEventListener('click', function () {
                    showSection(button.dataset.target);
                });
            });

            document.addEventListener('submit', (event) => {
                const questionForm = event.target.closest('.question-response-form');
                if (questionForm) {
                    event.preventDefault();
                    respondToStudentQuestion(
                        questionForm.dataset.questionId,
                        new FormData(questionForm).get('response')
                    ).catch((error) => {
                        console.error('Réponse à la question impossible :', error);
                        alert('Impossible d’envoyer la réponse. Vérifiez la connexion et les permissions Supabase.');
                    });
                    return;
                }

                const form = event.target.closest('.grading-form');
                if (form) {
                    event.preventDefault();
                    gradeSubmission(
                        form.dataset.submissionId,
                        new FormData(form).get('grade'),
                        new FormData(form).get('feedback')
                    ).catch((error) => {
                        console.error('Correction de l’exercice impossible :', error);
                        alert('Impossible d’enregistrer la correction. Vérifiez la connexion et les permissions Supabase.');
                    });
                }
            });

            document.getElementById('refreshTeacherQuestions')
                ?.addEventListener('click', actualiserQuestionsProfesseur);
            document.getElementById('courseForm').addEventListener('submit', handleSubmit);
            try {
                const loaded = await loadTeacherData();
                if (!loaded) return;
                document.getElementById('teacher').value = currentTeacher.name;
                renderCourses();
                renderStats();
                renderSubmissions();
                renderStudentQuestions();
            } catch (error) {
                console.error('Chargement du tableau professeur impossible :', error);
                alert(error.message || 'Impossible de charger les données du compte professeur.');
            }
        });
