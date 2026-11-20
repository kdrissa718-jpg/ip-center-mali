"use strict";

const formationId = new URLSearchParams(window.location.search).get("formation");
const requestedLessonId = new URLSearchParams(window.location.search).get("lesson");
const previewRequested = new URLSearchParams(window.location.search).get("preview") === "1";
const lessonList = document.getElementById("lessonList");
const lessonPanel = document.getElementById("lessonPanel");
const learningFeedback = document.getElementById("learningFeedback");
let lessons = [];
let questionsByLesson = new Map();
let progressByLesson = new Map();
let activeLessonId = null;
let currentStudentId = null;
let adminPreview = false;

function setLearningFeedback(message, isError = false) {
    learningFeedback.textContent = message;
    learningFeedback.classList.toggle("is-error", isError);
}

function createTextElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function getFirstIncompleteIndex() {
    return lessons.findIndex((lesson) => progressByLesson.get(lesson.id)?.status !== "passed");
}

function renderLessonList() {
    lessonList.replaceChildren();
    const firstIncomplete = getFirstIncompleteIndex();

    lessons.forEach((lesson, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const progress = progressByLesson.get(lesson.id);
        const completed = progress?.status === "passed";
        const locked = !adminPreview && !completed && index > firstIncomplete;
        button.type = "button";
        button.disabled = locked;
        button.setAttribute(
            "aria-current",
            String(lesson.id) === String(activeLessonId) ? "step" : "false"
        );
        button.appendChild(createTextElement("span", `${index + 1}. ${lesson.title}`));
        button.appendChild(createTextElement(
            "span",
            completed ? "Terminée" : progress?.status === "pending_correction" ? "Correction en attente" : locked ? "À débloquer" : progress?.status === "rejected" ? "À reprendre" : "À faire",
            "lesson-state"
        ));
        button.addEventListener("click", () => {
            activeLessonId = lesson.id;
            renderLessonList();
            renderActiveLesson();
        });
        item.appendChild(button);
        lessonList.appendChild(item);
    });
}

function renderQuestion(question, index, savedAnswer) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "quiz-question";
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${question.prompt}`;
    fieldset.appendChild(legend);

    if (question.question_type === "text") {
        const textarea = document.createElement("textarea");
        textarea.name = question.id;
        textarea.required = true;
        textarea.maxLength = 5000;
        textarea.disabled = adminPreview;
        textarea.placeholder = "Écrivez votre réponse ici...";
        textarea.value = typeof savedAnswer === "string" ? savedAnswer : "";
        fieldset.appendChild(textarea);
        return fieldset;
    }

    const multiple = question.question_type === "multiple_choice";
    const savedValues = multiple && Array.isArray(savedAnswer)
        ? savedAnswer
        : typeof savedAnswer === "string" ? [savedAnswer] : [];
    (question.options || []).forEach((option, optionIndex) => {
        const label = document.createElement("label");
        label.className = "quiz-option";
        const input = document.createElement("input");
        input.type = multiple ? "checkbox" : "radio";
        input.name = question.id;
        input.value = option;
        input.checked = savedValues.includes(option);
        input.disabled = adminPreview;
        input.setAttribute("aria-label", option);
        label.append(input, document.createTextNode(option));
        fieldset.appendChild(label);
    });
    return fieldset;
}

function renderActiveLesson() {
    const lesson = lessons.find((item) => String(item.id) === String(activeLessonId));
    lessonPanel.replaceChildren();
    if (!lesson) return;

    lessonPanel.appendChild(createTextElement("h2", lesson.title));
    lessonPanel.appendChild(createTextElement("p", lesson.content, "lesson-content"));
    if (adminPreview) {
        lessonPanel.appendChild(createTextElement(
            "p",
            "Aperçu administrateur en lecture seule : aucune réponse ni progression ne sera enregistrée.",
            "lesson-result"
        ));
    }
    if (lesson.video_url) {
        const videoLink = document.createElement("a");
        videoLink.className = "lesson-video-link";
        videoLink.href = lesson.video_url;
        videoLink.target = "_blank";
        videoLink.rel = "noopener noreferrer";
        videoLink.innerHTML = '<i class="fa-solid fa-circle-play" aria-hidden="true"></i> Ouvrir la vidéo de la leçon';
        lessonPanel.appendChild(videoLink);
    }

    const lessonQuestions = questionsByLesson.get(lesson.id) || [];
    const previousProgress = progressByLesson.get(lesson.id);
    const firstIncomplete = getFirstIncompleteIndex();
    const lessonIndex = lessons.findIndex((item) => item.id === lesson.id);
    const isCurrentLesson = lessonIndex === firstIncomplete;

    if (previousProgress?.status === "passed") {
        const result = createTextElement(
            "p",
            previousProgress.score_total > 0
                ? `Réponses enregistrées. Résultat des QCM : ${previousProgress.score_correct}/${previousProgress.score_total}. Les réponses écrites sont transmises sans correction automatique.`
                : "Vos réponses ont été enregistrées. Les réponses écrites sont transmises sans correction automatique.",
            "lesson-result"
        );
        lessonPanel.appendChild(result);
    }

    if (previousProgress?.status === "pending_correction") {
        lessonPanel.appendChild(createTextElement(
            "p",
            "Vos réponses ont été envoyées. Le professeur ou l’administration doit les corriger avant le déblocage de la prochaine étape.",
            "lesson-result"
        ));
        if (previousProgress.correction) lessonPanel.appendChild(createTextElement("p", `Correction : ${previousProgress.correction}`, "lesson-result"));
    } else if (previousProgress?.status === "rejected") {
        lessonPanel.appendChild(createTextElement("p", `Cette étape est à reprendre.${previousProgress.correction ? ` Correction : ${previousProgress.correction}` : " Corrigez vos réponses pour continuer."}`, "lesson-result is-error"));
    }

    if (adminPreview) {
        if (lessonQuestions.length) {
            const previewQuestions = document.createElement("div");
            previewQuestions.className = "lesson-quiz preview-quiz";
            lessonQuestions.forEach((question, index) => {
                previewQuestions.appendChild(renderQuestion(question, index, null));
            });
            lessonPanel.appendChild(previewQuestions);
        } else {
            lessonPanel.appendChild(createTextElement(
                "p",
                "Aucun exercice n’est associé à cette leçon.",
                "lesson-result"
            ));
        }
    } else if (isCurrentLesson && previousProgress?.status !== "pending_correction") {
        const form = document.createElement("form");
        form.className = "lesson-quiz";
        lessonQuestions.forEach((question, index) => {
            form.appendChild(renderQuestion(
                question,
                index,
                previousProgress?.answers?.[question.id]
            ));
        });
        const submitButton = document.createElement("button");
        submitButton.type = "submit";
        submitButton.className = "submit-lesson";
        submitButton.textContent = "Envoyer mes réponses et continuer";
        form.appendChild(submitButton);
        form.addEventListener("submit", (event) => submitLesson(event, lesson, lessonQuestions));
        lessonPanel.appendChild(form);
    } else if (lessonIndex === firstIncomplete && lessonQuestions.length === 0) {
        lessonPanel.appendChild(createTextElement(
            "p",
            "Cette leçon n'a pas encore d'exercice. Contactez l'administration de la formation.",
            "lesson-result"
        ));
    }

    if (getFirstIncompleteIndex() < 0) {
        const finish = document.createElement("div");
        finish.className = "course-complete";
        finish.appendChild(createTextElement("h2", "Formation terminée !"));
        finish.appendChild(createTextElement("p", "Toutes les étapes ont été validées."));
        const dashboardLink = document.createElement("a");
        dashboardLink.className = "submit-lesson finish-link";
        dashboardLink.href = "dashboard_etudient.html";
        dashboardLink.textContent = "Retour au tableau de bord";
        finish.appendChild(dashboardLink);
        lessonPanel.appendChild(finish);
    }
}

async function submitLesson(event, lesson, lessonQuestions) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const answers = {};

    for (const question of lessonQuestions) {
        const fields = [...form.elements].filter((field) => field.name === question.id);
        if (question.question_type === "multiple_choice") {
            answers[question.id] = fields.filter((field) => field.checked).map((field) => field.value);
            if (!answers[question.id].length) {
                setLearningFeedback("Choisissez au moins une réponse pour chaque question.", true);
                fields[0]?.focus();
                return;
            }
        } else {
            const field = fields[0];
            answers[question.id] = field?.value.trim() || "";
            if (!answers[question.id]) {
                setLearningFeedback("Répondez à toutes les questions avant de continuer.", true);
                field?.focus();
                return;
            }
        }
    }

    button.disabled = true;
    setLearningFeedback("Enregistrement de vos réponses...");
    try {
        const { data, error } = await window.supabaseClient.rpc("submit_formation_lesson", {
            p_lesson_id: lesson.id,
            p_answers: answers
        });
        if (error) throw error;

        progressByLesson.set(lesson.id, {
            lesson_id: lesson.id,
            answers,
            score_correct: Number(data.score_correct || 0),
            score_total: Number(data.score_total || 0),
            status: data.status,
            correction: data.correction || null,
            submitted_at: data.submitted_at
        });
        const passed = data.status === "passed";
        const nextLesson = passed ? lessons[lessons.findIndex((item) => item.id === lesson.id) + 1] : null;
        activeLessonId = nextLesson ? nextLesson.id : lesson.id;
        renderLessonList();
        renderActiveLesson();
        setLearningFeedback(data.status === "pending_correction"
            ? "Réponses envoyées. La prochaine étape sera débloquée après la correction du professeur ou de l’administration."
            : data.status === "rejected"
                ? "Certaines réponses sont incorrectes. Reprenez cette étape avant de continuer."
                : nextLesson
                    ? "Réponses corrigées. La prochaine leçon est maintenant débloquée."
                    : "Bravo, toutes les étapes de cette formation sont terminées.");
    } catch (error) {
        console.error("Enregistrement des réponses impossible :", error);
        setLearningFeedback(
            error.message || "Impossible d'enregistrer vos réponses. Réessayez.",
            true
        );
        button.disabled = false;
    }
}

async function loadLearningPath() {
    if (!formationId) throw new Error("Identifiant de formation manquant.");
    const client = window.supabaseClient;
    if (!client) throw new Error("Connexion Supabase indisponible.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user) {
        window.location.replace(`login.html?formation=${encodeURIComponent(formationId)}`);
        return;
    }
    currentStudentId = user.id;

    const [
        { data: profile, error: profileError },
        { data: formation, error: formationError },
        { data: access, error: accessError }
    ] = await Promise.all([
        client.from("profiles").select("role, status").eq("id", user.id).maybeSingle(),
        client.from("formations").select("id, title, description, is_open")
            .eq("id", formationId).maybeSingle(),
        client.from("student_formation_access").select("formation_id")
            .eq("student_id", user.id).eq("formation_id", formationId).maybeSingle()
    ]);
    if (profileError) throw profileError;
    if (formationError) throw formationError;
    if (accessError) throw accessError;
    const role = user.app_metadata?.role === "admin" ? "admin" : profile?.role;
    adminPreview = previewRequested && profile?.status === "Actif" && role === "admin";
    if (adminPreview) {
        currentStudentId = null;
        const backLink = document.querySelector(".back-link");
        if (backLink) {
            backLink.href = "dashboard_admin.html";
            backLink.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Retour au tableau admin';
        }
    } else if (profile?.status !== "Actif" || role !== "student") {
        throw new Error("Un compte étudiant actif est nécessaire pour suivre ce parcours.");
    }
    if (!formation || (!adminPreview && !access)) {
        throw new Error("Vous devez être inscrit à cette formation pour accéder aux leçons.");
    }
    if (!adminPreview && formation.is_open === false) {
        throw new Error("Cette formation est fermée par l’administration. Son parcours n’est plus accessible.");
    }

    document.getElementById("formationTitle").textContent =
        formation.title || formation.titre || "Formation";
    document.getElementById("formationDescription").textContent = formation.description || "";

    const [
        { data: lessonData, error: lessonError },
        { data: progressData, error: progressError }
    ] = await Promise.all([
        client.from("formation_lessons")
            .select("id, formation_id, title, content, video_url, position")
            .eq("formation_id", formationId)
            .order("position", { ascending: true }),
        adminPreview
            ? Promise.resolve({ data: [], error: null })
            : client.from("formation_lesson_progress")
                .select("lesson_id, answers, score_correct, score_total, submitted_at, status, correction")
                .eq("student_id", currentStudentId)
    ]);
    if (lessonError) throw lessonError;
    if (progressError) throw progressError;

    lessons = lessonData || [];
    progressByLesson = new Map((progressData || []).map((progress) => [
        progress.lesson_id,
        progress
    ]));
    const { data: questionData, error: questionError } = lessons.length
        ? await client.from("formation_lesson_questions")
            .select("id, lesson_id, prompt, question_type, options, position")
            .in("lesson_id", lessons.map((lesson) => lesson.id))
            .order("position", { ascending: true })
        : { data: [], error: null };
    if (questionError) throw questionError;

    questionsByLesson = new Map(lessons.map((lesson) => [lesson.id, []]));
    (questionData || []).forEach((question) => {
        questionsByLesson.get(question.lesson_id)?.push(question);
    });
    if (!adminPreview) {
        lessons = lessons.filter((lesson) => (questionsByLesson.get(lesson.id) || []).length > 0);
    }

    const firstIncomplete = getFirstIncompleteIndex();
    const requestedIndex = lessons.findIndex((lesson) => String(lesson.id) === String(requestedLessonId));
    const canOpenRequestedLesson = requestedIndex >= 0
        && (adminPreview || firstIncomplete < 0 || requestedIndex <= firstIncomplete);
    activeLessonId = lessons[canOpenRequestedLesson
        ? requestedIndex
        : firstIncomplete >= 0 ? firstIncomplete : 0]?.id || null;
    renderLessonList();
    if (!lessons.length) {
        lessonPanel.appendChild(createTextElement(
            "p",
            adminPreview
                ? "Aucune leçon n’a encore été ajoutée à cette formation."
                : "Les leçons et exercices de cette formation seront bientôt disponibles."
        ));
        setLearningFeedback(adminPreview
            ? "Aucune étape à prévisualiser pour le moment."
            : "Vous êtes inscrit à cette formation, mais aucun exercice n'a encore été publié.");
        return;
    }
    renderActiveLesson();
    setLearningFeedback(adminPreview
        ? `${lessons.length} étape(s) dans l’aperçu administrateur.`
        :
        firstIncomplete < 0
        ? "Toutes les étapes de cette formation sont terminées."
            : `${lessons.length} étape(s) dans cette formation. Répondez à toutes les questions pour débloquer la suivante.`
    );
}

document.addEventListener("DOMContentLoaded", () => {
    loadLearningPath().catch((error) => {
        console.error("Chargement du parcours impossible :", error);
        setLearningFeedback(error.message || "Impossible de charger cette formation.", true);
        lessonPanel.textContent = error.message || "Impossible de charger cette formation.";
    });
});
