"use strict";

const client = window.supabaseClient;
const managementFeedback = document.getElementById("managementFeedback");
const formationSelect = document.getElementById("formationSelect");
const lessonSelect = document.getElementById("lessonSelect");
const lessonForm = document.getElementById("lessonForm");
const questionForm = document.getElementById("questionForm");
const questionType = document.getElementById("questionType");
const questionOptions = document.getElementById("questionOptions");
const choiceFields = document.getElementById("choiceFields");
const correctAnswerFields = document.getElementById("correctAnswerFields");
const lessonList = document.getElementById("lessonList");
const studentAnswers = document.getElementById("studentAnswers");
let lessons = [];

function setManagementFeedback(message, isError = false) {
    managementFeedback.textContent = message;
    managementFeedback.classList.toggle("is-error", isError);
}

function currentOptions() {
    return [...new Set(questionOptions.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

function renderCorrectAnswerChoices() {
    correctAnswerFields.replaceChildren();
    const options = currentOptions();
    if (!options.length) {
        correctAnswerFields.appendChild(Object.assign(document.createElement("p"), {
            textContent: "Ajoutez les choix ci-dessus pour sélectionner la correction."
        }));
        return;
    }

    options.forEach((option, index) => {
        const label = document.createElement("label");
        label.className = "correct-answer-label";
        const input = document.createElement("input");
        input.type = questionType.value === "multiple_choice" ? "checkbox" : "radio";
        input.name = "correct_answer";
        input.value = option;
        if (index === 0 && questionType.value === "single_choice") input.checked = false;
        label.append(input, document.createTextNode(option));
        correctAnswerFields.appendChild(label);
    });
}

function updateQuestionTypeFields() {
    const hasChoices = questionType.value !== "text";
    choiceFields.hidden = !hasChoices;
    questionOptions.required = hasChoices;
    if (hasChoices) renderCorrectAnswerChoices();
}

function mapQuestionType(value) {
    return value === "single_choice" ? "Choix unique"
        : value === "multiple_choice" ? "Choix multiples"
            : "Réponse écrite";
}

function buildQuestionItem(question) {
    const item = document.createElement("li");
    item.className = "managed-question";
    const text = document.createElement("span");
    text.textContent = `${question.prompt} (${mapQuestionType(question.question_type)})`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-item";
    remove.textContent = "Supprimer";
    remove.addEventListener("click", () => deleteQuestion(question.id, remove));
    item.append(text, " ", remove);
    return item;
}

function renderLessons() {
    lessonList.replaceChildren();
    lessonSelect.replaceChildren();
    if (!lessons.length) {
        lessonList.appendChild(Object.assign(document.createElement("p"), {
            className: "empty-list",
            textContent: "Aucune leçon. Ajoutez-en une ci-dessus."
        }));
        lessonSelect.appendChild(new Option("Ajoutez d’abord une leçon", ""));
        studentAnswers.replaceChildren(Object.assign(document.createElement("p"), {
            className: "empty-list",
            textContent: "Aucune réponse étudiante pour le moment."
        }));
        return;
    }

    lessons.forEach((lesson) => {
        const option = new Option(lesson.title, lesson.id);
        lessonSelect.appendChild(option);

        const article = document.createElement("article");
        article.className = "managed-lesson";
        article.appendChild(Object.assign(document.createElement("h3"), {
            textContent: `${lesson.position}. ${lesson.title}`
        }));
        const questions = lesson.questions || [];
        article.appendChild(Object.assign(document.createElement("p"), {
            textContent: `${questions.length} question(s)`
        }));
        if (questions.length) {
            const list = document.createElement("ul");
            questions.forEach((question) => list.appendChild(buildQuestionItem(question)));
            article.appendChild(list);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-item";
        remove.textContent = "Supprimer la leçon et ses exercices";
        remove.addEventListener("click", () => deleteLesson(lesson, remove));
        article.appendChild(remove);
        lessonList.appendChild(article);
    });
}

function renderStudentAnswers(progressRows) {
    studentAnswers.replaceChildren();
    if (!progressRows.length) {
        studentAnswers.appendChild(Object.assign(document.createElement("p"), {
            className: "empty-list",
            textContent: "Aucune réponse étudiante pour le moment."
        }));
        return;
    }

    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    progressRows.forEach((progress) => {
        const lesson = lessonById.get(progress.lesson_id);
        if (!lesson) return;
        const article = document.createElement("article");
        article.className = "managed-lesson student-answer";
        article.appendChild(Object.assign(document.createElement("h3"), {
            textContent: lesson.title
        }));
        article.appendChild(Object.assign(document.createElement("p"), {
            textContent: `Étudiant : ${progress.student_id} · ${new Date(progress.submitted_at).toLocaleString("fr-FR")}`
        }));
        if (progress.score_total > 0) {
            article.appendChild(Object.assign(document.createElement("p"), {
                textContent: `QCM : ${progress.score_correct}/${progress.score_total}`
            }));
        }

        const answers = document.createElement("ul");
        (lesson.questions || []).forEach((question) => {
            const response = progress.answers?.[question.id];
            const answerText = Array.isArray(response)
                ? response.join(" · ")
                : response || "Aucune réponse enregistrée";
            const item = document.createElement("li");
            item.appendChild(Object.assign(document.createElement("strong"), {
                textContent: question.prompt
            }));
            item.appendChild(document.createTextNode(` — ${answerText}`));
            answers.appendChild(item);
        });
        article.appendChild(answers);
        const state = progress.status === "passed" ? "Étape validée"
            : progress.status === "rejected" ? "À reprendre par l’étudiant"
                : progress.status === "pending_correction" ? "Correction attendue"
                    : "Réponses reçues";
        article.appendChild(Object.assign(document.createElement("p"), {
            className: `submission-state${progress.status === "rejected" ? " is-error" : ""}`,
            textContent: `${state}${progress.correction ? ` · ${progress.correction}` : ""}`
        }));
        if (["pending_correction", "submitted"].includes(progress.status)) {
            const form = document.createElement("form");
            form.className = "lesson-grading-form";
            form.dataset.studentId = progress.student_id;
            form.dataset.lessonId = progress.lesson_id;
            const feedback = document.createElement("label");
            feedback.textContent = "Commentaire de correction (facultatif)";
            const comment = document.createElement("textarea");
            comment.name = "correction";
            comment.maxLength = 3000;
            comment.value = progress.correction || "";
            feedback.appendChild(comment);
            const passed = document.createElement("button");
            passed.type = "submit";
            passed.name = "passed";
            passed.value = "true";
            passed.className = "management-button";
            passed.textContent = "Valider et débloquer la suite";
            const retry = document.createElement("button");
            retry.type = "submit";
            retry.name = "passed";
            retry.value = "false";
            retry.className = "delete-item";
            retry.textContent = "Demander une reprise";
            form.append(feedback, passed, retry);
            article.appendChild(form);
        }
        studentAnswers.appendChild(article);
    });
}

async function loadLessons() {
    const formationId = formationSelect.value;
    lessons = [];
    renderLessons();
    if (!formationId) {
        renderStudentAnswers([]);
        return;
    }

    const { data: lessonData, error: lessonError } = await client
        .from("formation_lessons")
        .select("id, formation_id, title, content, video_url, position")
        .eq("formation_id", formationId)
        .order("position", { ascending: true });
    if (lessonError) throw lessonError;

    lessons = lessonData || [];
    if (lessons.length) {
        const { data: questionData, error: questionError } = await client
            .from("formation_lesson_questions")
            .select("id, lesson_id, prompt, question_type, options, position")
            .in("lesson_id", lessons.map((lesson) => lesson.id))
            .order("position", { ascending: true });
        if (questionError) throw questionError;
        const questionsByLesson = new Map(lessons.map((lesson) => [lesson.id, []]));
        (questionData || []).forEach((question) => {
            questionsByLesson.get(question.lesson_id)?.push(question);
        });
        lessons.forEach((lesson) => {
            lesson.questions = questionsByLesson.get(lesson.id) || [];
        });
    }
    renderLessons();

    if (!lessons.length) {
        renderStudentAnswers([]);
        return;
    }
    const { data: progressRows, error: progressError } = await client
        .from("formation_lesson_progress")
        .select("student_id, lesson_id, answers, score_correct, score_total, submitted_at, status, correction")
        .in("lesson_id", lessons.map((lesson) => lesson.id))
        .order("submitted_at", { ascending: false });
    if (progressError) throw progressError;
    renderStudentAnswers(progressRows || []);
}

async function loadManagement() {
    if (!client) throw new Error("Connexion Supabase indisponible.");
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) {
        window.location.replace("login.html");
        return;
    }

    const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role, status")
        .eq("id", authData.user.id)
        .maybeSingle();
    if (profileError) throw profileError;
    const role = authData.user.app_metadata?.role === "admin" ? "admin" : profile?.role;
    if (!["admin", "teacher"].includes(role) || profile?.status !== "Actif") {
        throw new Error("Cette page est réservée aux professeurs et administrateurs actifs.");
    }
    if (role === "teacher") {
        document.getElementById("managementBackLink").href = "dashboard_professeur.html";
        document.getElementById("managementBackLink").textContent = "← Retour à l’espace professeur";
    }

    let query = client.from("formations").select("id, title").order("id", { ascending: false });
    if (role === "teacher") {
        const { data: courses, error: courseError } = await client.from("cours")
            .select("formation_id").eq("professor_id", authData.user.id).not("formation_id", "is", null);
        if (courseError) throw courseError;
        const formationIds = [...new Set((courses || []).map((course) => String(course.formation_id)))];
        query = formationIds.length
            ? client.from("formations").select("id, title").in("id", formationIds).order("id", { ascending: false })
            : null;
    }
    const { data, error } = query ? await query : { data: [], error: null };
    if (error) throw error;

    formationSelect.replaceChildren(new Option("Choisissez une formation", ""));
    (data || []).forEach((formation) => {
        formationSelect.appendChild(new Option(
            formation.title || "Formation",
            String(formation.id)
        ));
    });
    const requestedFormationId = new URLSearchParams(window.location.search).get("formation");
    if ((data || []).some((formation) => String(formation.id) === requestedFormationId)) {
        formationSelect.value = requestedFormationId;
        await loadLessons();
    }
    setManagementFeedback(`${(data || []).length} formation(s) disponible(s).`);
}

async function saveLesson(event) {
    event.preventDefault();
    const button = lessonForm.querySelector('button[type="submit"]');
    const formationId = formationSelect.value;
    if (!formationId) {
        setManagementFeedback("Choisissez d’abord une formation.", true);
        return;
    }

    const formData = new FormData(lessonForm);
    button.disabled = true;
    try {
        const { error } = await client.rpc("admin_save_formation_lesson", {
            p_formation_id: formationId,
            p_title: formData.get("title").toString().trim(),
            p_content: formData.get("content").toString().trim(),
            p_video_url: formData.get("video_url").toString().trim() || null
        });
        if (error) throw error;
        lessonForm.reset();
        await loadLessons();
        setManagementFeedback("Leçon enregistrée. Ajoutez maintenant ses exercices.");
    } catch (error) {
        console.error("Enregistrement de la leçon impossible :", error);
        setManagementFeedback(error.message || "Impossible d’enregistrer la leçon.", true);
    } finally {
        button.disabled = false;
    }
}

async function saveQuestion(event) {
    event.preventDefault();
    const button = questionForm.querySelector('button[type="submit"]');
    const type = questionType.value;
    const options = type === "text" ? [] : currentOptions();
    const selectedAnswers = [...correctAnswerFields.querySelectorAll("input:checked")]
        .map((input) => input.value);
    if (!lessonSelect.value) {
        setManagementFeedback("Choisissez une leçon avant d’ajouter une question.", true);
        return;
    }
    if (type !== "text" && options.length < 2) {
        setManagementFeedback("Proposez au moins deux choix différents.", true);
        return;
    }
    if (type !== "text" && !selectedAnswers.length) {
        setManagementFeedback("Désignez au moins une bonne réponse.", true);
        return;
    }
    if (type === "single_choice" && selectedAnswers.length !== 1) {
        setManagementFeedback("Désignez une seule bonne réponse.", true);
        return;
    }

    const correctAnswer = type === "text"
        ? null
        : type === "single_choice" ? selectedAnswers[0] : selectedAnswers;
    button.disabled = true;
    try {
        const { error } = await client.rpc("admin_save_formation_question", {
            p_lesson_id: lessonSelect.value,
            p_prompt: new FormData(questionForm).get("prompt").toString().trim(),
            p_question_type: type,
            p_options: options,
            p_correct_answer: correctAnswer
        });
        if (error) throw error;
        questionForm.reset();
        updateQuestionTypeFields();
        await loadLessons();
        setManagementFeedback("Question ajoutée à la leçon.");
    } catch (error) {
        console.error("Enregistrement de la question impossible :", error);
        setManagementFeedback(error.message || "Impossible d’enregistrer la question.", true);
    } finally {
        button.disabled = false;
    }
}

async function deleteLesson(lesson, button) {
    if (!window.confirm(`Supprimer « ${lesson.title} », ses questions et la progression des étudiants ?`)) return;
    button.disabled = true;
    try {
        const { error } = await client.rpc("admin_delete_formation_lesson", {
            p_lesson_id: lesson.id
        });
        if (error) throw error;
        await loadLessons();
        setManagementFeedback("Leçon et progression associée supprimées.");
    } catch (error) {
        console.error("Suppression de la leçon impossible :", error);
        setManagementFeedback(error.message || "Impossible de supprimer la leçon.", true);
        button.disabled = false;
    }
}

async function deleteQuestion(questionId, button) {
    if (!window.confirm("Supprimer cette question ? La progression de tous les étudiants sur cette leçon sera réinitialisée.")) return;
    button.disabled = true;
    try {
        const { error } = await client.rpc("admin_delete_formation_question", {
            p_question_id: questionId
        });
        if (error) throw error;
        await loadLessons();
        setManagementFeedback("Question supprimée et progression de la leçon réinitialisée.");
    } catch (error) {
        console.error("Suppression de la question impossible :", error);
        setManagementFeedback(error.message || "Impossible de supprimer la question.", true);
        button.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    formationSelect.addEventListener("change", () => {
        loadLessons().catch((error) => {
            console.error("Chargement des leçons impossible :", error);
            setManagementFeedback(error.message || "Impossible de charger les leçons.", true);
        });
    });
    lessonForm.addEventListener("submit", saveLesson);
    questionForm.addEventListener("submit", saveQuestion);
    studentAnswers.addEventListener("submit", async (event) => {
        const form = event.target.closest(".lesson-grading-form");
        if (!form) return;
        event.preventDefault();
        const button = event.submitter;
        if (!button || !["true", "false"].includes(button.value)) return;
        form.querySelectorAll("button").forEach((item) => { item.disabled = true; });
        try {
            const { error } = await client.rpc("grade_formation_lesson_progress", {
                p_student_id: form.dataset.studentId,
                p_lesson_id: form.dataset.lessonId,
                p_passed: button.value === "true",
                p_correction: new FormData(form).get("correction")
            });
            if (error) throw error;
            await loadLessons();
            setManagementFeedback(button.value === "true"
                ? "Étape validée : la suite est débloquée pour l’étudiant."
                : "Correction envoyée : l’étudiant doit reprendre cette étape.");
        } catch (error) {
            console.error("Correction de l’étape impossible :", error);
            setManagementFeedback(error.message || "Impossible d’enregistrer la correction.", true);
            form.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        }
    });
    questionType.addEventListener("change", updateQuestionTypeFields);
    questionOptions.addEventListener("input", renderCorrectAnswerChoices);
    updateQuestionTypeFields();
    loadManagement().catch((error) => {
        console.error("Initialisation de la gestion des parcours impossible :", error);
        setManagementFeedback(error.message || "Impossible de charger la gestion.", true);
    });
});
