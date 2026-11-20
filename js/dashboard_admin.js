"use strict";

/* =========================================================
   IP CENTER MALI — DASHBOARD ADMINISTRATEUR
   Supabase Auth, cours, formations et Storage
   ========================================================= */

const permissions = {
    admin: [
        "Accéder au dashboard administrateur",
        "Gérer les utilisateurs et les rôles",
        "Valider, modifier ou bloquer les comptes",
        "Voir les cours et contenus",
        "Configurer les paramètres du site",
        "Consulter les messages"
    ],
    teacher: [
        "Accéder au dashboard professeur",
        "Publier des cours avec fichiers et vidéos",
        "Voir ses cours publiés",
        "Consulter les statistiques",
        "Répondre aux questions des étudiants"
    ],
    student: [
        "Accéder au dashboard étudiant",
        "Voir les cours disponibles",
        "Ouvrir les formations autorisées",
        "Poser des questions aux professeurs",
        "Suivre ses ressources"
    ]
};

const FORMATION_STORAGE_BUCKET = "formation-files";
const MAX_IMAGE_MB = 5;
const MAX_VIDEO_MB = 100;
const MAX_PDF_MB = 20;

let users = [];
let courses = [];
let formations = [];

let messages = [];
let studentQuestions = [];

let editingUserId = null;
let editingFormationId = null;
let adminAccessGranted = false;

/* =========================================================
   OUTILS GÉNÉRAUX
   ========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function roleLabel(role) {
    return {
        admin: "Administrateur",
        teacher: "Professeur",
        student: "Étudiant"
    }[role] || role || "Non défini";
}

function getSupabaseClient() {
    return window.supabaseClient || null;
}

function showElement(id, visible) {
    const element = document.getElementById(id);
    if (element) element.hidden = !visible;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value ?? "");
}

function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value ?? "";
}

function safeDisplayUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(value);

        return ["http:", "https:"].includes(url.protocol)
            ? url.href
            : "";
    } catch {
        return "";
    }
}

function formatPrice(value) {
    const amount = Number(value || 0);

    return Number.isFinite(amount)
        ? amount.toLocaleString("fr-FR")
        : "0";
}

function setFormationFeedback(message, isError = false) {
    const element = document.getElementById("formationFeedback");

    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#b91c1c" : "#166534";
}

function setSettingsFeedback(message, isError = false) {
    const element = document.getElementById("settingsFeedback");

    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#b91c1c" : "#166534";
}

/* =========================================================
   AUTHENTIFICATION ET AUTORISATION ADMIN
   ========================================================= */

async function guardAdminAccess() {
    const client = getSupabaseClient();

    if (!client) {
        console.error("Client Supabase indisponible.");

        showElement("accessAlert", true);
        setText(
            "accessAlertMessage",
            "Connexion Supabase indisponible. Vérifie scriptsupabase.js."
        );

        return false;
    }

    try {
        const { data, error } = await client.auth.getUser();
        const user = data?.user;

        if (error || !user) {
            console.error("Utilisateur non authentifié :", error);

            showElement("accessAlert", true);
            setText(
                "accessAlertMessage",
                "Session absente ou expirée. Reconnecte-toi."
            );

            return false;
        }

        const { data: profile, error: profileError } = await client
            .from("profiles")
            .select("full_name, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (profile?.status === "Bloqué") {
            showElement("accessAlert", true);
            setText("accessAlertMessage", "Ce compte administrateur est bloqué.");
            await client.auth.signOut();
            return false;
        }

        const appRole = String(user.app_metadata?.role || "").trim().toLowerCase();
        const profileRole = String(profile?.role || "").trim().toLowerCase();
        const role = appRole === "admin" || profileRole === "admin"
            ? "admin"
            : profileRole || appRole || "non défini";

        const name =
            profile?.full_name ||
            user.user_metadata?.nom ||
            user.user_metadata?.name ||
            user.email ||
            "Administrateur";

        setText("adminName", name);

        console.info("Compte authentifié :", user.email);
        console.info("Rôle Supabase détecté :", role);

        if (role !== "admin") {
            showElement("accessAlert", true);

            setText(
                "accessAlertMessage",
                `Accès refusé pour ${user.email || "ce compte"}. Rôle lu dans Supabase : « ${role} ». Le profil public doit avoir role = admin.`
            );

            return false;
        }

        console.info("Accès administrateur autorisé.");
        showElement("accessAlert", false);
        return true;

    } catch (error) {
        console.error(
            "Erreur de vérification administrateur :",
            error
        );

        showElement("accessAlert", true);

        setText(
            "accessAlertMessage",
            "Erreur lors de la vérification du compte."
        );

        return false;
    }
}

/* =========================================================
   NAVIGATION ET DÉCONNEXION
   ========================================================= */

function bindNavigation() {
    document.querySelectorAll(".nav-item").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach((item) => {
                item.classList.remove("active");
            });

            document.querySelectorAll(".dashboard-section").forEach((section) => {
                section.classList.remove("active");
            });

            button.classList.add("active");

            const section = document.getElementById(
                button.dataset.section
            );

            if (section) section.classList.add("active");

            if (button.dataset.section === "courses") {
                loadCoursesFromSupabase();
                loadFormationsFromSupabase();
            }
            if (button.dataset.section === "messages") {
                loadMessagesFromSupabase()
                    .then(renderMessages)
                    .catch((error) => {
                        console.error("Actualisation des messages impossible :", error);
                        const container = document.getElementById("messageList");
                        if (container) container.textContent = error.message || "Impossible de charger les messages.";
                    });
            }
        });
    });

    document.getElementById("refreshContactMessages")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await loadMessagesFromSupabase();
            renderMessages();
        } catch (error) {
            console.error("Actualisation des messages impossible :", error);
            alert(error.message || "Impossible d’actualiser les messages de contact.");
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById("messageList")?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-delete-contact-message]");
        if (!button) return;

        const messageId = button.dataset.deleteContactMessage;
        const message = messages.find((item) => String(item.id) === String(messageId));
        if (!message || !window.confirm(`Supprimer définitivement le message « ${message.subject || "Message de contact"} » ?`)) return;

        button.disabled = true;
        try {
            if (!adminAccessGranted) throw new Error("Accès administrateur requis.");
            const client = getSupabaseClient();
            if (!client) throw new Error("Client Supabase indisponible.");
            const { data, error } = await client.from("contact_messages")
                .delete()
                .eq("id", messageId)
                .select("id")
                .maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("Le message n’a pas été supprimé. Actualisez la liste et réessayez.");

            messages = messages.filter((item) => String(item.id) !== String(messageId));
            renderMessages();
        } catch (error) {
            console.error("Suppression du message de contact impossible :", error);
            alert(error.message || "Impossible de supprimer le message.");
            button.disabled = false;
        }
    });

    document.querySelectorAll('[data-action="logout"]').forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();

            try {
                const client = getSupabaseClient();

                if (client) {
                    const { error } = await client.auth.signOut();

                    if (error) {
                        console.error(
                            "Erreur de déconnexion Supabase :",
                            error
                        );
                    }
                }
            } catch (error) {
                console.error("Erreur de déconnexion :", error);
            }

            window.location.replace("login.html");
        });
    });
}

/* =========================================================
   UTILISATEURS
   Profils Supabase et comptes Auth.
   ========================================================= */

async function loadUsersFromSupabase() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");

    const { data, error } = await client
        .from("profiles")
        .select("id, full_name, email, role, status")
        .order("created_at", { ascending: false });

    if (error) throw error;

    users = (data || []).map((profile) => ({
        id: profile.id,
        name: profile.full_name || "Utilisateur",
        email: String(profile.email || "").trim().toLowerCase(),
        role: profile.role,
        status: profile.status
    }));
}

async function loadMessagesFromSupabase() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");

    const { data, error } = await client
        .from("contact_messages")
        .select("id, sender_name, sender_email, sender_phone, subject, message_type, content_preview, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

    if (error) throw error;

    messages = data || [];
}

async function loadStudentQuestionsFromSupabase() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");

    const { data, error } = await client
        .from("student_questions")
        .select("id, student_id, teacher_id, course_title, question, response, status, created_at, responded_at")
        .order("created_at", { ascending: false })
        .limit(500);

    if (error) throw error;

    studentQuestions = data || [];
}

async function respondToStudentQuestion(questionId, responseValue) {
    if (!adminAccessGranted) throw new Error("Accès administrateur requis.");

    const question = studentQuestions.find((item) => String(item.id) === String(questionId));
    const response = String(responseValue || "").trim();
    if (!question) throw new Error("Cette question n’existe plus. Actualisez la liste.");
    if (!response) {
        alert("Écrivez votre réponse avant de l’envoyer.");
        return;
    }

    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");
    const { data, error } = await client
        .from("student_questions")
        .update({
            response,
            status: "Répondue",
            responded_at: new Date().toISOString()
        })
        .eq("id", question.id)
        .select("id, student_id, teacher_id, course_title, question, response, status, created_at, responded_at")
        .single();

    if (error) throw error;

    const index = studentQuestions.findIndex((item) => String(item.id) === String(question.id));
    studentQuestions[index] = data;
    renderStudentQuestions();
    alert("Votre réponse a été envoyée dans le dashboard de l’étudiant.");
}

function bindUserTools() {
    document.getElementById("userSearch")
        ?.addEventListener("input", renderUsers);

    document.getElementById("roleFilter")
        ?.addEventListener("change", renderUsers);

    document.getElementById("usersTable")
        ?.addEventListener("click", (event) => {
            const button = event.target.closest("[data-user-action]");

            if (!button) return;

            const id = button.dataset.userId;

            if (button.dataset.userAction === "edit") {
                editUser(id);
            }

            if (button.dataset.userAction === "toggle-block") {
                toggleBlockUser(id).catch((error) => {
                    console.error("Modification du statut utilisateur impossible :", error);
                    alert("Impossible de modifier le statut du compte.");
                });
            }
        });

    document.getElementById("addUserBtn")
        ?.addEventListener("click", () => openUserModal());

    document.getElementById("closeModal")
        ?.addEventListener("click", closeUserModal);

    document.getElementById("userModal")
        ?.addEventListener("click", (event) => {
            if (event.target.id === "userModal") {
                closeUserModal();
            }
        });

    document.getElementById("userForm")
        ?.addEventListener("submit", async (event) => {
            event.preventDefault();

            const name =
                document.getElementById("modalName")?.value.trim() || "";

            const email =
                document.getElementById("modalEmail")
                    ?.value.trim().toLowerCase() || "";

            const role =
                document.getElementById("modalRole")?.value || "student";

            const status =
                document.getElementById("modalStatus")?.value || "Actif";

            if (!name || !email) {
                alert("Le nom et l'adresse e-mail sont obligatoires.");
                return;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                alert("Saisis une adresse e-mail valide.");
                return;
            }

            const duplicate = users.some((user) =>
                user.email === email &&
                String(user.id) !== String(editingUserId)
            );

            if (duplicate) {
                alert("Cette adresse e-mail existe déjà dans la liste.");
                return;
            }

            const client = getSupabaseClient();
            const submitButton = document.querySelector("#userForm [type='submit']");
            if (!client) {
                alert("Client Supabase indisponible.");
                return;
            }

            if (submitButton) submitButton.disabled = true;
            try {
                const { error } = await client.functions.invoke("admin-users", {
                    body: {
                        action: editingUserId ? "update" : "invite",
                        id: editingUserId,
                        name,
                        email,
                        role,
                        status
                    }
                });
                if (error) throw error;

                await loadUsersFromSupabase();
                closeUserModal();
                renderAll();
            } catch (error) {
                console.error("Enregistrement utilisateur Supabase impossible :", error);
                alert(error.message || "Impossible d'enregistrer le compte.");
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });

    document.getElementById("refreshCoursesBtn")
        ?.addEventListener("click", loadCoursesFromSupabase);
}

function openUserModal(user = null) {
    editingUserId = user?.id ?? null;

    setInputValue("modalName", user?.name || "");
    setInputValue("modalEmail", user?.email || "");
    setInputValue("modalRole", user?.role || "student");
    setInputValue("modalStatus", user?.status || "Actif");
    const emailInput = document.getElementById("modalEmail");
    if (emailInput) emailInput.readOnly = Boolean(user);

    showElement("userModal", true);
}

function closeUserModal() {
    editingUserId = null;
    showElement("userModal", false);
}

function editUser(id) {
    const user = users.find(
        (item) => String(item.id) === String(id)
    );

    if (user) openUserModal(user);
}

async function toggleBlockUser(id) {
    const user = users.find((item) => String(item.id) === String(id));
    if (!user) throw new Error("Utilisateur introuvable.");

    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");

    const status = user.status === "Bloqué" ? "Actif" : "Bloqué";
    const { error } = await client.functions.invoke("admin-users", {
        body: {
            action: "update",
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status
        }
    });
    if (error) throw error;

    await loadUsersFromSupabase();
    renderAll();
}

/* =========================================================
   PARAMÈTRES SUPABASE
   ========================================================= */

function bindSettings() {
    const form = document.getElementById("settingsForm");

    if (!form) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const settings = {
            centre:
                document.getElementById("settingCentre")?.value.trim() || "",

            email:
                document.getElementById("settingEmail")?.value.trim() || "",

            telephone:
                document.getElementById("settingTelephone")?.value.trim() || "",

            validation:
                document.getElementById("settingValidation")?.checked ?? true,

            publication:
                document.getElementById("settingPublication")?.checked ?? true
        };

        try {
            const client = getSupabaseClient();
            if (!client) throw new Error("Client Supabase indisponible.");
            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData?.user) throw new Error("Session administrateur absente.");

            const { error } = await client.from("site_settings").upsert({
                id: 1,
                settings,
                updated_by: authData.user.id,
                updated_at: new Date().toISOString()
            }, { onConflict: "id" });
            if (error) throw error;

            setSettingsFeedback("Paramètres enregistrés dans Supabase.");
        } catch (error) {
            console.error(
                "Erreur d'enregistrement des paramètres :",
                error
            );

            setSettingsFeedback("Enregistrement impossible.", true);
        }
    });
}

async function loadSettingsFromSupabase() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Client Supabase indisponible.");

    const { data, error } = await client
        .from("site_settings")
        .select("settings")
        .eq("id", 1)
        .maybeSingle();

    if (error) throw error;

    const settings = data?.settings || {};
    setInputValue("settingCentre", settings.centre || "IP Center Mali");
    setInputValue("settingEmail", settings.email || "");
    setInputValue("settingTelephone", settings.telephone || "");

    const validation = document.getElementById("settingValidation");
    const publication = document.getElementById("settingPublication");
    if (validation) validation.checked = settings.validation !== false;
    if (publication) publication.checked = settings.publication !== false;
}

/* =========================================================
   COURS — TABLE SUPABASE : cours
   ========================================================= */

async function loadCoursesFromSupabase() {
    const client = getSupabaseClient();
    const container = document.getElementById("adminCourses");

    if (!client) {
        courses = [];
        if (container) container.textContent = "Connexion Supabase indisponible.";
        renderAll();
        return;
    }

    if (container) {
        container.textContent = "Chargement des cours...";
    }

    try {
        const { data, error } = await client
            .from("cours")
            .select("id, formation_id, professor_id, title, description, status, is_open")
            .order("id", { ascending: false })
            .limit(100);

        if (error) throw error;

        courses = (data || []).map((course) => ({
            id: course.id,
            title: course.title || "Cours sans titre",
            description: course.description || "",
            formationId: course.formation_id,
            professorId: course.professor_id,
            teacher: course.professor_id
                ? `ID professeur : ${course.professor_id}`
                : "Professeur non renseigné",
            status: course.status || "Publié",
            isOpen: course.is_open !== false
        }));

        console.info("Cours chargés depuis Supabase :", courses.length);

    } catch (error) {
        console.error("Erreur de chargement des cours :", error);

        if (container) {
            container.textContent =
                "Impossible de charger les cours. Vérifie la table cours et les politiques RLS.";
        }

        courses = [];
    }

    renderAll();
}

/* =========================================================
   FORMATIONS — ÉVÉNEMENTS ET FORMULAIRE
   ========================================================= */

function bindFormations() {
    document.getElementById("formationForm")
        ?.addEventListener("submit", saveFormation);

    document.getElementById("cancelFormationBtn")
        ?.addEventListener("click", resetFormationForm);

    document.getElementById("refreshFormationsBtn")
        ?.addEventListener("click", loadFormationsFromSupabase);

    document.getElementById("formationsAdminList")
        ?.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-formation-action]");

            if (!button) return;

            const id = button.dataset.formationId;

            if (button.dataset.formationAction === "toggle-open") {
                await setFormationOpen(id, button.dataset.isOpen !== "true");
                return;
            }

            if (button.dataset.formationAction === "edit") {
                const formation = formations.find(
                    (item) => String(item.id) === String(id)
                );

                if (formation) fillFormationForm(formation);
            }

            if (button.dataset.formationAction === "delete") {
                await deleteFormation(id);
            }
        });

    document.getElementById("adminCourses")?.addEventListener("click", async (event) => {
        const button = event.target.closest('[data-course-action="toggle-open"]');
        if (!button) return;
        await setCourseOpen(button.dataset.courseId, button.dataset.isOpen !== "true");
    });

    document.getElementById("adminCourses")?.addEventListener("change", async (event) => {
        const select = event.target.closest("[data-course-formation]");
        if (!select) return;
        select.disabled = true;
        try {
            const { error } = await getSupabaseClient().from("cours")
                .update({ formation_id: select.value || null })
                .eq("id", select.dataset.courseId);
            if (error) throw error;
            const course = courses.find((item) => String(item.id) === select.dataset.courseId);
            if (course) course.formationId = select.value || null;
            await loadFormationsFromSupabase();
        } catch (error) {
            console.error("Affectation du cours à une modalité impossible :", error);
            alert(error.message || "Impossible d’affecter le cours à cette modalité.");
            select.disabled = false;
        }
    });
}

async function setCourseOpen(courseId, isOpen) {
    const client = getSupabaseClient();
    if (!client) return;
    try {
        const { error } = await client.rpc("admin_set_course_open", {
            p_course_id: String(courseId),
            p_is_open: isOpen
        });
        if (error) throw error;
        const course = courses.find((item) => String(item.id) === String(courseId));
        if (course) course.isOpen = isOpen;
        renderCourses();
        await loadFormationsFromSupabase();
    } catch (error) {
        console.error("Changement d’accès au cours impossible :", error);
        alert(error.message || "Impossible de modifier l’accès à ce cours.");
    }
}

async function setFormationOpen(formationId, isOpen) {
    const client = getSupabaseClient();
    if (!client) return;
    try {
        const { error } = await client.rpc("admin_set_formation_open", {
            p_formation_id: String(formationId),
            p_is_open: isOpen
        });
        if (error) throw error;
        const formation = formations.find((item) => String(item.id) === String(formationId));
        if (formation) formation.is_open = isOpen;
        renderFormationsAdmin();
        renderCourses();
    } catch (error) {
        console.error("Changement d’accès à la formation impossible :", error);
        alert(error.message || "Impossible de modifier l’accès à cette formation.");
    }
}

function resetFormationForm() {
    const form = document.getElementById("formationForm");

    if (form) form.reset();

    setInputValue("formationId", "");
    setInputValue("formationPrix", "0");

    editingFormationId = null;

    const button = document.getElementById("saveFormationBtn");

    if (button) {
        button.disabled = false;
        button.innerHTML =
            '<i class="fas fa-floppy-disk"></i> Enregistrer la formation';
    }

    setFormationFeedback("");
}

function fillFormationForm(formation) {
    editingFormationId = formation.id;

    setInputValue("formationId", formation.id);
    setInputValue(
        "formationTitre",
        formation.title || formation.titre || ""
    );
    setInputValue("formationCategorie", formation.categorie || "");
    setInputValue("formationDescription", formation.description || "");
    setInputValue("formationPrix", formation.prix ?? 0);
    setInputValue("formationDuree", formation.duree || "");

    setInputValue(
        "formationCouverture",
        formation.couverture_url || ""
    );

    setInputValue("formationYoutube", formation.youtube_url || "");
    setInputValue("formationVideo", formation.video_url || "");
    setInputValue("formationPdf", formation.pdf_url || "");

    // Les champs de fichiers ne peuvent pas être préremplis.
    const button = document.getElementById("saveFormationBtn");

    if (button) {
        button.innerHTML =
            '<i class="fas fa-pen"></i> Enregistrer les modifications';
    }

    setFormationFeedback(
        "Modification de la formation sélectionnée."
    );

    document.getElementById("formationForm")
        ?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
}

function optionalUrl(value, label) {
    const trimmed = String(value || "").trim();

    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);

        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Protocole invalide");
        }

        return url.href;

    } catch {
        throw new Error(
            `Le lien « ${label} » n'est pas une URL valide.`
        );
    }
}

/* =========================================================
   TÉLÉVERSEMENT SUPABASE STORAGE
   Bucket requis : formation-files
   ========================================================= */

function getSelectedFile(inputId) {
    return document.getElementById(inputId)?.files?.[0] || null;
}

async function uploadFormationFile(inputId, maxSizeMB, allowedTypes) {
    const file = getSelectedFile(inputId);

    // Sans nouveau fichier, l'URL déjà saisie sera conservée.
    if (!file) return null;

    const client = getSupabaseClient();

    if (!client) {
        throw new Error("Connexion Supabase indisponible.");
    }

    if (!allowedTypes.includes(file.type)) {
        throw new Error(
            `Le format du fichier « ${file.name} » n'est pas autorisé.`
        );
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
        throw new Error(
            `Le fichier « ${file.name} » dépasse la limite de ${maxSizeMB} Mo.`
        );
    }

    const { data: authData, error: authError } =
        await client.auth.getUser();

    if (authError || !authData?.user) {
        throw new Error("Session absente. Reconnecte-toi.");
    }

    const user = authData.user;
    const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role, status")
        .eq("id", user.id)
        .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.status === "Bloqué") {
        throw new Error("Ce compte administrateur est bloqué.");
    }

    if (
        user.app_metadata?.role !== "admin" &&
        profile?.role !== "admin"
    ) {
        throw new Error(
            "Le rôle administrateur est requis pour téléverser."
        );
    }

    const safeName = file.name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-120);

    const randomId = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const filePath =
        `formations/${user.id}/${randomId}-${safeName}`;

    setFormationFeedback(
        `Téléversement de « ${file.name} » en cours...`
    );

    const { data: uploaded, error: uploadError } = await client.storage
        .from(FORMATION_STORAGE_BUCKET)
        .upload(filePath, file, {
            contentType: file.type,
            upsert: false
        });

    if (uploadError) {
        console.error(
            "Erreur de téléversement Supabase :",
            uploadError
        );

        throw new Error(
            `Téléversement impossible : ${uploadError.message}`
        );
    }

    const { data: urlData } = client.storage
        .from(FORMATION_STORAGE_BUCKET)
        .getPublicUrl(uploaded?.path || filePath);

    if (!urlData?.publicUrl) {
        throw new Error(
            "Aucune URL publique n'a été retournée pour le fichier."
        );
    }

    return urlData.publicUrl;
}

/* =========================================================
   AJOUT ET MODIFICATION DES FORMATIONS
   ========================================================= */

async function saveFormation(event) {
    event.preventDefault();

    const client = getSupabaseClient();

    if (!client) {
        setFormationFeedback(
            "Connexion Supabase introuvable.",
            true
        );
        return;
    }

    const title =
        document.getElementById("formationTitre")?.value.trim() || "";

    const prix =
        Number(document.getElementById("formationPrix")?.value);

    if (!title) {
        setFormationFeedback("Le titre est obligatoire.", true);
        return;
    }

    if (!Number.isFinite(prix) || prix < 0) {
        setFormationFeedback("Saisis un prix valide.", true);
        return;
    }

    const saveButton =
        document.getElementById("saveFormationBtn");

    if (saveButton) saveButton.disabled = true;

    const isEditing =
        editingFormationId !== null &&
        editingFormationId !== "";

    try {
        setFormationFeedback(
            "Vérification des champs et téléversement..."
        );

        const imageUrl = await uploadFormationFile(
            "formationCouvertureFile",
            MAX_IMAGE_MB,
            ["image/jpeg", "image/png", "image/webp"]
        );

        const videoUrl = await uploadFormationFile(
            "formationVideoFile",
            MAX_VIDEO_MB,
            ["video/mp4", "video/webm", "video/quicktime"]
        );

        const pdfUrl = await uploadFormationFile(
            "formationPdfFile",
            MAX_PDF_MB,
            ["application/pdf"]
        );

        const categorie =
            document.getElementById("formationCategorie")?.value.trim() || "";

        if (!categorie) {
            setFormationFeedback(
                "Choisis une catégorie pour cette formation.",
                true
            );
            return;
        }

        const payload = {
            title: title,
            categorie: categorie,

            description:
                document.getElementById("formationDescription")
                    ?.value.trim() || "",

            prix: prix,

            duree:
                document.getElementById("formationDuree")
                    ?.value.trim() || "",

            couverture_url: optionalUrl(
                imageUrl ||
                document.getElementById("formationCouverture")?.value,
                "couverture"
            ),

            youtube_url: optionalUrl(
                document.getElementById("formationYoutube")?.value,
                "YouTube"
            ),

            video_url: optionalUrl(
                videoUrl ||
                document.getElementById("formationVideo")?.value,
                "vidéo"
            ),

            pdf_url: optionalUrl(
                pdfUrl ||
                document.getElementById("formationPdf")?.value,
                "PDF"
            )
        };

        setFormationFeedback("Enregistrement dans Supabase...");

        let result;

        if (isEditing) {
            result = await client
                .from("formations")
                .update(payload)
                .eq("id", editingFormationId)
                .select();
        } else {
            result = await client
                .from("formations")
                .insert(payload)
                .select();
        }

        if (result.error) throw result.error;

        if (!result.data || result.data.length === 0) {
            throw new Error(
                "Aucune ligne retournée. Vérifie les permissions RLS de la table formations."
            );
        }

        await loadFormationsFromSupabase();

        resetFormationForm();

        setFormationFeedback(
            isEditing
                ? "Formation modifiée avec succès."
                : "Formation enregistrée avec succès."
        );

    } catch (error) {
        console.error(
            "Erreur d'enregistrement de formation :",
            error
        );

        setFormationFeedback(
            error.message || "Impossible d'enregistrer la formation.",
            true
        );

    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

/* =========================================================
   CHARGEMENT DES FORMATIONS
   ========================================================= */

async function loadFormationsFromSupabase() {
    const client = getSupabaseClient();

    const container =
        document.getElementById("formationsAdminList");

    if (!container) return;

    if (!client) {
        container.textContent =
            "Connexion Supabase indisponible.";
        return;
    }

    container.textContent = "Chargement des formations...";

    try {
        const { data, error } = await client
            .from("formations")
            .select("*")
            .order("id", { ascending: false });

        if (error) throw error;

        formations = Array.isArray(data) ? data : [];

        if (window.ModalitePlaylist) {
            const playlists = await window.ModalitePlaylist.load(formations, client);
            formations.forEach((formation) => {
                formation.playlist = playlists.get(String(formation.id)) || { courses: [], lessons: [] };
            });
        }

        console.info(
            "Formations chargées depuis Supabase :",
            formations.length
        );

        renderFormationsAdmin();
        renderCourses();

    } catch (error) {
        console.error(
            "Erreur de chargement des formations :",
            error
        );

        container.textContent =
            "Impossible de charger les formations. Vérifie la table et les autorisations Supabase.";
    }
}

/* =========================================================
   AFFICHAGE DES FORMATIONS
   ========================================================= */

function renderFormationsAdmin() {
    const container =
        document.getElementById("formationsAdminList");

    if (!container) return;

    if (!Array.isArray(formations) || formations.length === 0) {
        container.textContent =
            "Aucune formation enregistrée pour le moment.";
        return;
    }

    container.innerHTML = formations.map((formation) => {
        const titre = escapeHtml(
            formation.title ||
            formation.titre ||
            "Formation sans titre"
        );

        const description = escapeHtml(
            formation.description || ""
        );

        const categorie = escapeHtml(
            formation.categorie || "Catégorie non définie"
        );

        const prix = formatPrice(formation.prix);

        const duree = escapeHtml(
            formation.duree || "Non précisée"
        );

        const image = safeDisplayUrl(
            formation.couverture_url
        );

        const video = safeDisplayUrl(
            formation.video_url
        );

        const youtube = safeDisplayUrl(
            formation.youtube_url
        );

        const pdf = safeDisplayUrl(
            formation.pdf_url
        );

        const formationId = escapeHtml(
            String(formation.id ?? "")
        );

        return `
            <article class="formation-admin-card modalite-formation" data-modality="${categorie}">

                <span class="badge availability-badge ${formation.is_open === false ? "closed" : "open"}">
                    ${formation.is_open === false ? "Fermée aux étudiants" : "Ouverte aux étudiants"}
                </span>

                ${image ? `
                    <img
                        src="${escapeHtml(image)}"
                        alt="${titre}"
                        loading="lazy"
                    >
                ` : ""}

                <h3>${titre}</h3>

                <div class="formation-admin-description">
                    <p class="formation-admin-description-text">
                        ${description || "Aucune description."}
                    </p>
                    <div class="formation-admin-description-navigation" role="group" aria-label="Navigation dans la description">
                        <button class="formation-admin-description-button formation-admin-description-previous" type="button" hidden>Précédent</button>
                        <button class="formation-admin-description-button formation-admin-description-next" type="button" hidden>Suivant</button>
                    </div>
                </div>

                <p><strong>Catégorie :</strong> ${categorie}</p>

                <p>
                    <strong>Prix :</strong>
                    ${prix} FCFA
                </p>

                <p>
                    <strong>Durée :</strong>
                    ${duree}
                </p>

                <div class="resource-links">

                    ${youtube ? `
                        <a
                            href="${escapeHtml(youtube)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <i class="fab fa-youtube"></i>
                            YouTube
                        </a>
                    ` : ""}

                    ${video ? `
                        <a
                            href="${escapeHtml(video)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <i class="fas fa-video"></i>
                            Vidéo
                        </a>
                    ` : ""}

                    ${pdf ? `
                        <a
                            href="${escapeHtml(pdf)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <i class="fas fa-file-pdf"></i>
                            PDF
                        </a>
                    ` : ""}

                </div>

                ${window.ModalitePlaylist ? window.ModalitePlaylist.render(formation, { showClosedContent: true }) : ""}

                <div class="actions">

                    <button
                        class="icon-btn availability-toggle"
                        type="button"
                        data-formation-action="toggle-open"
                        data-is-open="${formation.is_open !== false}"
                        data-formation-id="${formationId}"
                    >
                        ${formation.is_open === false ? "Rouvrir" : "Fermer l’accès"}
                    </button>

                    <button
                        class="icon-btn"
                        type="button"
                        data-formation-action="edit"
                        data-formation-id="${formationId}"
                    >
                        <i class="fas fa-pen"></i>
                        Modifier
                    </button>

                    <button
                        class="icon-btn danger"
                        type="button"
                        data-formation-action="delete"
                        data-formation-id="${formationId}"
                    >
                        <i class="fas fa-trash"></i>
                        Supprimer
                    </button>

                </div>

            </article>
        `;
    }).join("");
    const cards = [...container.querySelectorAll(".formation-admin-card")];
    const groups = new Map();
    cards.forEach((card) => {
        const category = card.dataset.modality || "Autres cours";
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(card);
    });
    container.replaceChildren();
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "fr"))
        .forEach(([category, categoryCards]) => {
            const group = document.createElement("details");
            group.className = "modalite-group";
            const summary = document.createElement("summary");
            summary.className = "modalite-group-title";
            summary.textContent = category;
            const count = document.createElement("span");
            count.className = "modalite-group-count";
            count.textContent = `${categoryCards.length} formation(s)`;
            summary.appendChild(count);
            const content = document.createElement("div");
            content.className = "modalite-group-content admin-modalite-grid";
            categoryCards.forEach((card) => content.appendChild(card));
            group.append(summary, content);
            container.appendChild(group);
        });
    initializeFormationDescriptionNavigation(container);
}

function initializeFormationDescriptionNavigation(container) {
    container.querySelectorAll(".formation-admin-description").forEach((block) => {
        const description = block.querySelector(".formation-admin-description-text");
        const navigation = block.querySelector(".formation-admin-description-navigation");
        const previous = block.querySelector(".formation-admin-description-previous");
        const next = block.querySelector(".formation-admin-description-next");
        if (!description || !navigation || !previous || !next) return;

        const update = () => {
            const maxScroll = Math.max(0, description.scrollHeight - description.clientHeight);
            navigation.hidden = maxScroll <= 1;
            previous.hidden = maxScroll <= 1 || description.scrollTop <= 1;
            next.hidden = maxScroll <= 1 || description.scrollTop >= maxScroll - 1;
        };
        const scroll = (direction) => {
            description.scrollTo({
                top: Math.max(0, Math.min(
                    description.scrollHeight - description.clientHeight,
                    description.scrollTop + direction * description.clientHeight
                )),
                behavior: "smooth"
            });
        };

        previous.addEventListener("click", () => scroll(-1));
        next.addEventListener("click", () => scroll(1));
        description.addEventListener("scroll", update, { passive: true });
        update();
    });
}

/* =========================================================
   SUPPRESSION D'UNE FORMATION
   ========================================================= */

async function deleteFormation(id) {
    if (!confirm("Veux-tu vraiment supprimer cette formation ?")) {
        return;
    }

    const client = getSupabaseClient();

    if (!client) {
        setFormationFeedback(
            "Connexion Supabase introuvable.",
            true
        );
        return;
    }

    try {
        const { data, error } = await client
            .from("formations")
            .delete()
            .eq("id", id)
            .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error(
                "Aucune formation supprimée. Vérifie les permissions RLS."
            );
        }

        formations = formations.filter(
            (formation) => String(formation.id) !== String(id)
        );

        renderFormationsAdmin();

        if (String(editingFormationId) === String(id)) {
            resetFormationForm();
        }

        setFormationFeedback("Formation supprimée.");

    } catch (error) {
        console.error("Erreur de suppression :", error);

        setFormationFeedback(
            error.message || "Suppression impossible.",
            true
        );
    }
}

/* =========================================================
   AFFICHAGE DU DASHBOARD
   ========================================================= */

function renderAll() {
    renderStats();
    renderUsers();
    renderCourses();
    renderLearningPathOptions();
    renderPermissions();
    renderMessages();
    renderStudentQuestions();
    renderActivity();
}

function renderLearningPathOptions() {
    const select = document.getElementById("adminLearningFormation");
    if (!select) return;
    const selectedId = select.value;
    select.replaceChildren(new Option("Choisir une formation", ""));
    formations.forEach((formation) => {
        select.appendChild(new Option(
            formation.title || formation.titre || "Formation",
            String(formation.id)
        ));
    });
    if (formations.some((formation) => String(formation.id) === selectedId)) {
        select.value = selectedId;
    }
    updateLearningPathLinks();
}

function updateLearningPathLinks() {
    const formationId = document.getElementById("adminLearningFormation")?.value;
    const manageLink = document.getElementById("manageLearningPathLink");
    const previewLink = document.getElementById("previewLearningPathLink");
    const hasFormation = Boolean(formationId);
    if (manageLink) {
        manageLink.href = hasFormation
            ? `gestion-parcours.html?formation=${encodeURIComponent(formationId)}`
            : "gestion-parcours.html";
        manageLink.setAttribute("aria-disabled", String(!hasFormation));
        manageLink.classList.toggle("is-disabled", !hasFormation);
    }
    if (previewLink) {
        previewLink.href = hasFormation
            ? `parcours-formation.html?formation=${encodeURIComponent(formationId)}&preview=1`
            : "dashboard_admin.html";
        previewLink.setAttribute("aria-disabled", String(!hasFormation));
        previewLink.classList.toggle("is-disabled", !hasFormation);
    }
}

function bindLearningPathTools() {
    document.getElementById("adminLearningFormation")
        ?.addEventListener("change", updateLearningPathLinks);
    ["manageLearningPathLink", "previewLearningPathLink"].forEach((id) => {
        document.getElementById(id)?.addEventListener("click", (event) => {
            if (event.currentTarget.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
            }
        });
    });
}

function renderStats() {
    setText("statUsers", users.length);

    setText(
        "statStudents",
        users.filter((user) => user.role === "student").length
    );

    setText(
        "statTeachers",
        users.filter((user) => user.role === "teacher").length
    );

    setText("statCourses", courses.length);
}

function renderUsers() {
    const search =
        (document.getElementById("userSearch")?.value || "")
            .toLowerCase();

    const role =
        document.getElementById("roleFilter")?.value || "all";

    const table = document.getElementById("usersTable");

    if (!table) return;

    const filtered = users.filter((user) => {
        const matchesRole =
            role === "all" || user.role === role;

        const haystack =
            `${user.name} ${user.email} ${user.role}`.toLowerCase();

        return matchesRole && haystack.includes(search);
    });

    if (filtered.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="5">
                    Aucun utilisateur dans cette liste.
                </td>
            </tr>
        `;
        return;
    }

    table.innerHTML = filtered.map((user) => `
        <tr>
            <td>${escapeHtml(user.name)}</td>
            <td>${escapeHtml(user.email)}</td>

            <td>
                <span class="badge ${escapeHtml(user.role)}">
                    ${escapeHtml(roleLabel(user.role))}
                </span>
            </td>

            <td>
                <span class="badge status">
                    ${escapeHtml(user.status)}
                </span>
            </td>

            <td>
                <div class="actions">
                    <button
                        class="icon-btn"
                        type="button"
                        title="Modifier"
                        data-user-action="edit"
                        data-user-id="${escapeHtml(user.id)}"
                    >
                        <i class="fas fa-pen"></i>
                    </button>

                    <button
                        class="icon-btn danger"
                        type="button"
                        title="Bloquer ou débloquer"
                        data-user-action="toggle-block"
                        data-user-id="${escapeHtml(user.id)}"
                    >
                        <i class="fas fa-ban"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
}

function renderCourses() {
    const container = document.getElementById("adminCourses");

    if (!container) return;

    if (!courses.length) {
        container.textContent =
            "Aucun cours retourné par Supabase pour le moment.";
        return;
    }

    container.innerHTML = courses.map((course) => `
        <article class="course-card ${course.isOpen === false ? "is-closed" : ""}">

            <span class="badge status">
                ${escapeHtml(course.status || "Publié")}
            </span>
            <span class="badge availability-badge ${course.isOpen === false ? "closed" : "open"}">
                ${course.isOpen === false ? "Fermé aux étudiants" : "Ouvert aux étudiants"}
            </span>

            <h3>${escapeHtml(course.title)}</h3>

            <p>
                ${escapeHtml(course.description || "Aucune description")}
            </p>

            <label class="course-modality-select">
                Modalité / formation associée
                <select data-course-formation data-course-id="${escapeHtml(course.id)}">
                    <option value="">Aucune modalité associée</option>
                    ${formations.map((formation) => `
                        <option value="${escapeHtml(formation.id)}" ${String(course.formationId || "") === String(formation.id) ? "selected" : ""}>
                            ${escapeHtml(formation.title || formation.titre || "Formation")}
                        </option>
                    `).join("")}
                </select>
            </label>

            <p>
                <strong>Professeur :</strong>
                ${escapeHtml(course.teacher || "Non renseigné")}
            </p>

            <button class="availability-toggle" type="button"
                data-course-action="toggle-open"
                data-course-id="${escapeHtml(course.id)}"
                data-is-open="${course.isOpen !== false}">
                ${course.isOpen === false ? "Rouvrir le cours" : "Fermer l’accès étudiant"}
            </button>

        </article>
    `).join("");
}

function renderPermissions() {
    const grid = document.getElementById("permissionsGrid");
    const summary = document.getElementById("roleSummary");

    if (grid) {
        grid.innerHTML = Object.entries(permissions)
            .map(([role, items]) => `
                <article class="permission-card">

                    <span class="badge ${role}">
                        ${escapeHtml(roleLabel(role))}
                    </span>

                    <h3>${items.length} autorisations</h3>

                    <ul class="permission-list">
                        ${items.map((item) => `
                            <li>
                                <i class="fas fa-check"></i>
                                <span>${escapeHtml(item)}</span>
                            </li>
                        `).join("")}
                    </ul>

                </article>
            `).join("");
    }

    if (summary) {
        summary.innerHTML = Object.entries(permissions)
            .map(([role, items]) => `
                <div class="role-pill">
                    <span class="badge ${role}">
                        ${escapeHtml(roleLabel(role))}
                    </span>
                    <strong>${items.length}</strong>
                </div>
            `).join("");
    }
}

function renderMessages() {
    const container = document.getElementById("messageList");

    if (!container) return;

    if (!messages.length) {
        container.innerHTML = '<div class="empty-state">Aucun message reçu.</div>';
        return;
    }

    container.innerHTML = messages.map((message) => {
        const title = message.subject ||
            (message.message_type === "audio" ? "Message audio" : "Chat de support");
        const content = message.content_preview;
        const sender = [message.sender_name, message.sender_email]
            .filter(Boolean)
            .join(" · ") || "Visiteur";

        return `
            <article class="message-card" data-message-id="${escapeHtml(message.id)}">
                <span class="badge status">${escapeHtml(message.status || "Nouveau")}</span>
                <h3>${escapeHtml(title)}</h3>
                <p><strong>${escapeHtml(sender)}</strong></p>
                ${message.sender_phone ? `<p><strong>Téléphone :</strong> <a href="tel:${escapeHtml(message.sender_phone)}">${escapeHtml(message.sender_phone)}</a></p>` : ""}
                <p>${escapeHtml(content)}</p>
                <small>${new Date(message.created_at).toLocaleString("fr-FR")}</small>
                <button class="message-delete-btn" type="button" data-delete-contact-message="${escapeHtml(message.id)}">
                    <i class="fas fa-trash" aria-hidden="true"></i> Supprimer ce message
                </button>
            </article>
        `;
    }).join("");
}

function renderStudentQuestions() {
    const container = document.getElementById("studentQuestionsAdmin");
    if (!container) return;

    if (!studentQuestions.length) {
        container.innerHTML = '<div class="empty-state">Aucune question étudiante reçue.</div>';
        return;
    }

    container.innerHTML = studentQuestions.map((question) => {
        const student = users.find((user) => String(user.id) === String(question.student_id));
        const teacher = users.find((user) => String(user.id) === String(question.teacher_id));
        const studentLabel = student
            ? [student.name, student.email].filter(Boolean).join(" · ")
            : String(question.student_id || "").slice(0, 8) || "Compte étudiant";
        const teacherLabel = teacher
            ? [teacher.name, teacher.email].filter(Boolean).join(" · ")
            : String(question.teacher_id || "").slice(0, 8);

        return `
        <article class="message-card student-question-card">
            <span class="question-status ${question.response ? "is-answered" : "is-pending"}">
                ${question.response ? "Répondue" : "En attente"}
            </span>
            <h3>${escapeHtml(question.course_title || "Question à l’administration")}</h3>
            <p><strong>Étudiant :</strong> ${escapeHtml(studentLabel)}</p>
            ${question.teacher_id
                ? `<p><strong>Professeur concerné :</strong> ${escapeHtml(teacherLabel)}</p>`
                : `<p><strong>Destinataire :</strong> Administration</p>`
            }
            <p>${escapeHtml(question.question)}</p>
            <small>Reçue le ${new Date(question.created_at).toLocaleString("fr-FR")}</small>
            ${question.response
                ? `<div class="question-response"><strong>Réponse envoyée</strong><p>${escapeHtml(question.response)}</p><small>Le ${new Date(question.responded_at || question.created_at).toLocaleString("fr-FR")}</small></div>`
                : `<form class="admin-question-response-form" data-question-id="${escapeHtml(question.id)}"><label>Réponse à l’étudiant<textarea name="response" required maxlength="5000" placeholder="Rédigez une réponse à transmettre à l’étudiant."></textarea></label><button class="primary-btn" type="submit">Envoyer au dashboard étudiant</button></form>`
            }
        </article>
    `;
    }).join("");
}

function renderActivity() {
    const container = document.getElementById("activityList");

    if (!container) return;

    const pendingCount = users.filter(
        (user) => user.status === "En attente"
    ).length;

    const activity = [
        "Connexion administrateur détectée",
        `${pendingCount} compte(s) en attente`,
        `${courses.length} cours retourné(s) par la base`,
        "Matrice des autorisations chargée"
    ];

    container.innerHTML = activity.map((item) => `
        <div class="activity-item">
            <span>${escapeHtml(item)}</span>
            <small>Session actuelle</small>
        </div>
    `).join("");
}

/* =========================================================
   INITIALISATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    bindNavigation();
    bindLearningPathTools();
    bindUserTools();
    bindSettings();
    bindFormations();
    document.getElementById("refreshStudentQuestionsAdmin")
        ?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await loadStudentQuestionsFromSupabase();
                renderStudentQuestions();
            } catch (error) {
                console.error("Actualisation des questions étudiantes impossible :", error);
                alert("Impossible d’actualiser les questions. Vérifiez votre connexion et réessayez.");
            } finally {
                button.disabled = false;
            }
        });

    document.addEventListener("submit", (event) => {
        const form = event.target.closest(".admin-question-response-form");
        if (!form) return;
        event.preventDefault();
        respondToStudentQuestion(
            form.dataset.questionId,
            new FormData(form).get("response")
        ).catch((error) => {
            console.error("Réponse administrateur impossible :", error);
            alert("Impossible d’envoyer la réponse. Vérifiez la connexion et les permissions Supabase.");
        });
    });

    adminAccessGranted = await guardAdminAccess();
    document.body.classList.add(
        adminAccessGranted
            ? "dashboard-access-granted"
            : "dashboard-access-check-failed"
    );

    if (!adminAccessGranted) {
        console.warn(
            "Dashboard non initialisé : accès administrateur non confirmé."
        );
        return;
    }

    renderAll();

    const loaders = [
        loadUsersFromSupabase(),
        loadSettingsFromSupabase(),
        loadMessagesFromSupabase(),
        loadStudentQuestionsFromSupabase(),
        loadCoursesFromSupabase(),
        loadFormationsFromSupabase()
    ];
    const results = await Promise.allSettled(loaders);
    renderAll();

    const errorTargets = [
        { index: 0, id: "usersTable", message: "Impossible de charger les utilisateurs depuis Supabase." },
        { index: 1, id: "settingsFeedback", message: "Impossible de charger les paramètres depuis Supabase." },
        { index: 2, id: "messageList", message: "Impossible de charger les messages depuis Supabase." },
        { index: 3, id: "studentQuestionsAdmin", message: "Impossible de charger les questions des étudiants." }
    ];
    errorTargets.forEach(({ index, id, message }) => {
        const result = results[index];
        if (result.status !== "rejected") return;
        console.error(message, result.reason);
        const element = document.getElementById(id);
        if (element) element.textContent = message;
    });
});
