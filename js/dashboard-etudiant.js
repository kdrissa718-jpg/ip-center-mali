/**
 * Dashboard Étudiant - Gestion complète du tableau de bord
 * Fonctionnalités : Cours, Achats, Questions
 */

// ========================================
// AFFICHAGE/MASQUAGE DES SECTIONS
// ========================================
function show(id, activeButton) {
    // Masquer toutes les sections
    document.querySelectorAll(".content-section").forEach(function (section) {
        section.style.display = "none";
    });

    // Retirer la classe active de tous les boutons
    document.querySelectorAll(".sidebar button").forEach(function (button) {
        button.classList.remove("active");
    });

    // Ajouter la classe active au bouton sélectionné
    if (activeButton) {
        activeButton.classList.add("active");
    }

    // Afficher la section sélectionnée
    const section = document.getElementById(id);
    if (section) {
        section.style.display = "block";
    }

    // Charger les données spécifiques selon la section
    if (id === "my") {
        loadPurchases();
    }

    if (id === "ask") {
        loadQuestions();
    }
}

// ========================================
// UTILITAIRES DE STOCKAGE LOCAL
// ========================================
function getSavedItems(key) {
    return JSON.parse(localStorage.getItem(key) || "[]");
}

function setSavedItems(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
}

function escapeForOnclick(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, " ");
}

// ========================================
// GESTION DES ACHATS
// ========================================
function savePurchase(title, description, price, url, fileName) {
    const purchases = getSavedItems("studentPurchases");
    const exists = purchases.some(function (purchase) {
        return purchase.title === title;
    });

    if (!exists) {
        purchases.unshift({
            title,
            description,
            price,
            url,
            fileName,
            date: new Date().toLocaleDateString("fr-FR")
        });

        setSavedItems("studentPurchases", purchases);
    }

    loadPurchases();
}

function loadPurchases() {
    const container = document.getElementById("purchasesContainer");

    if (!container) return;

    const purchases = getSavedItems("studentPurchases");

    if (purchases.length === 0) {
        container.innerHTML = "<p style=\"text-align:center;color:#999;\">Aucun achat pour le moment.</p>";
        return;
    }

    container.innerHTML = purchases.map(function (purchase) {
        return `
            <div class="auto-item">
                <h3>${purchase.title}</h3>
                <p>${purchase.description || "Cours acheté"}</p>
                <p><strong>Prix :</strong> ${purchase.price || ""}</p>
                <p><small>Acheté le ${purchase.date}</small></p>
                <button class="open-course-btn" onclick="window.open('${purchase.url || "#"}','_blank')">
                    📂 Ouvrir le cours
                </button>
            </div>
        `;
    }).join("");
}

// ========================================
// GESTION DES QUESTIONS
// ========================================
function sendQuestion() {
    const courseInput = document.getElementById("questionCourse");
    const questionInput = document.getElementById("questionText");
    const course = courseInput.value.trim();
    const question = questionInput.value.trim();

    if (!course || !question) {
        alert("Veuillez remplir le cours et la question.");
        return;
    }

    const questions = getSavedItems("studentQuestions");

    questions.unshift({
        course,
        question,
        date: new Date().toLocaleString("fr-FR"),
        status: "Envoyée"
    });

    setSavedItems("studentQuestions", questions);
    courseInput.value = "";
    questionInput.value = "";
    loadQuestions();
    alert("Question envoyée avec succès ✅");
}

function loadQuestions() {
    const container = document.getElementById("questionsContainer");

    if (!container) return;

    const questions = getSavedItems("studentQuestions");

    if (questions.length === 0) {
        container.innerHTML = "<p style=\"text-align:center;color:#999;\">Aucune question envoyée pour le moment.</p>";
        return;
    }

    container.innerHTML = questions.map(function (item) {
        return `
            <div class="auto-item">
                <h3>${item.course}</h3>
                <p>${item.question}</p>
                <p><strong>Statut :</strong> <span style="color:#2563eb;">${item.status}</span></p>
                <p><small>📅 ${item.date}</small></p>
            </div>
        `;
    }).join("");
}

// ========================================
// GESTION DES COURS (FIREBASE/SUPABASE)
// ========================================
async function loadCourses() {
    const coursesContainer = document.getElementById("coursesContainer");

    coursesContainer.innerHTML = "<p style=\"text-align:center;\">⏳ Chargement des cours...</p>";

    try {
        const { data: courses, error } = await supabaseClient
            .from("courses")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error(error);
            // Si erreur Supabase, afficher les cours prédéfinis
            displayDefaultCourses();
            return;
        }

        if (!courses || courses.length === 0) {
            // Si aucun cours dans Supabase, afficher les cours prédéfinis
            displayDefaultCourses();
            return;
        }

        coursesContainer.innerHTML = "";

        courses.forEach((course) => {
            const safeId = escapeForOnclick(course.id);
            const safeUrl = escapeForOnclick(course.file_url);
            const safeFileName = escapeForOnclick(course.file_name);
            const safeTitle = escapeForOnclick(course.title);
            const safeDescription = escapeForOnclick(course.description);
            const safePrice = escapeForOnclick(course.price);

            coursesContainer.innerHTML += `
                <div class="course-card">
                    <div class="course-image">
                        <img src="${course.image_url}" alt="${course.title}">
                    </div>
                    <div class="course-info">
                        <h3>${course.title}</h3>
                        <p class="course-description">${course.description}</p>
                        <p><strong>👨‍🏫 Professeur :</strong> ${course.teacher}</p>
                        <p><strong>💰 Prix :</strong> ${course.price} FCFA</p>
                    </div>
                    <div id="content-${course.id}" class="locked-content">
                        <p style="color:red;margin-bottom:15px;">🔒 Ce cours est verrouillé. Achetez-le pour accéder au contenu.</p>
                        <button class="buy-btn" onclick="buyCourse(
                            '${safeId}',
                            '${safeUrl}',
                            '${safeFileName}',
                            '${safeTitle}',
                            '${safeDescription}',
                            '${safePrice}'
                        )">🛒 Acheter maintenant</button>
                    </div>
                </div>
            `;
        });
    } catch (error) {
        console.error("Erreur:", error);
        displayDefaultCourses();
    }
}

// ========================================
// COURS PRÉDÉFINIS
// ========================================
function displayDefaultCourses() {
    const coursesContainer = document.getElementById("coursesContainer");
    
    const defaultCourses = [
        {
            id: "cours-1",
            title: "Mathématiques Niveau 1",
            description: "Initiation aux mathématiques : algèbre, géométrie et calcul",
            teacher: "Prof. Dramane Keïta",
            price: "2000",
            image_url: "https://via.placeholder.com/300x200?text=Mathematiques",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Mathématiques%20Niveau%201",
            file_name: "whatsapp"
        },
        {
            id: "cours-2",
            title: "Réseaux Informatique",
            description: "Comprendre les fondamentaux des réseaux TCP/IP et les protocoles",
            teacher: "Prof. Kassim Diallo",
            price: "3000",
            image_url: "https://via.placeholder.com/300x200?text=Reseaux",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Réseaux%20Informatique",
            file_name: "whatsapp"
        },
        {
            id: "cours-3",
            title: "Programmation Web - HTML/CSS",
            description: "Créer des sites web modernes avec HTML5 et CSS3",
            teacher: "Prof. Fatou Traoré",
            price: "2500",
            image_url: "https://via.placeholder.com/300x200?text=Web+Development",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Programmation%20Web",
            file_name: "whatsapp"
        },
        {
            id: "cours-4",
            title: "Base de Données - SQL",
            description: "Maîtriser SQL et la gestion des bases de données relationnelles",
            teacher: "Prof. Mohamed Keïta",
            price: "3500",
            image_url: "https://via.placeholder.com/300x200?text=Database+SQL",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Base%20de%20Données%20SQL",
            file_name: "whatsapp"
        },
        {
            id: "cours-5",
            title: "Sécurité Informatique",
            description: "Principes de sécurité, cryptographie et protection des données",
            teacher: "Prof. Jérôme Coulibaly",
            price: "4000",
            image_url: "https://via.placeholder.com/300x200?text=Cybersecurity",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Sécurité%20Informatique",
            file_name: "whatsapp"
        },
        {
            id: "cours-6",
            title: "Développement Mobile - Flutter",
            description: "Créer des applications mobiles cross-platform avec Flutter",
            teacher: "Prof. Aïssa Togola",
            price: "4500",
            image_url: "https://via.placeholder.com/300x200?text=Mobile+App",
            file_url: "https://wa.me/22392488730?text=Intéressé%20par%20le%20cours%20Développement%20Mobile",
            file_name: "whatsapp"
        }
    ];

    coursesContainer.innerHTML = "";

    defaultCourses.forEach((course) => {
        const safeId = escapeForOnclick(course.id);
        const safeUrl = escapeForOnclick(course.file_url);
        const safeFileName = escapeForOnclick(course.file_name);
        const safeTitle = escapeForOnclick(course.title);
        const safeDescription = escapeForOnclick(course.description);
        const safePrice = escapeForOnclick(course.price);

        coursesContainer.innerHTML += `
            <div class="course-card">
                <div class="course-image">
                    <img src="${course.image_url}" alt="${course.title}">
                </div>
                <div class="course-info">
                    <h3>${course.title}</h3>
                    <p class="course-description">${course.description}</p>
                    <p><strong>👨‍🏫 Professeur :</strong> ${course.teacher}</p>
                    <p><strong>💰 Prix :</strong> ${course.price} FCFA</p>
                </div>
                <div id="content-${course.id}" class="locked-content">
                    <p style="color:red;margin-bottom:15px;">🔒 Ce cours est verrouillé. Contactez-nous pour plus d'infos.</p>
                    <button class="buy-btn" onclick="contactViaWhatsApp(
                        '${safeTitle}',
                        '${safePrice}'
                    )">💬 Contacter sur WhatsApp</button>
                </div>
            </div>
        `;
    });
}

// ========================================
// SYSTÈME D'ACHAT DE COURS
// ========================================
function contactViaWhatsApp(courseTitle, coursePrice) {
    const message = `Bonjour, je suis intéressé par le cours "${courseTitle}" (${coursePrice} FCFA). Pouvez-vous me fournir plus d'informations ?`;
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/22392488730?text=${encodedMessage}`, "_blank");
}

function buyCourse(courseId, url, fileName, title, description, price) {
    const confirmed = confirm(`Confirmer l'achat du cours "${title}" pour ${price} FCFA ?`);
    
    if (!confirmed) return;

    alert("✅ Paiement effectué avec succès !");

    savePurchase(title || "Cours acheté", description || "", price ? price + " FCFA" : "", url, fileName);

    const content = document.getElementById("content-" + courseId);

    const isVideo = fileName && (fileName.endsWith(".mp4") || fileName.endsWith(".webm") || fileName.endsWith(".ogg"));
    const isPDF = fileName && fileName.endsWith(".pdf");
    const isExternal = url.includes("http");

    if (isVideo) {
        content.innerHTML = `
            <div class="unlocked-content">
                <p style="color:green;margin-bottom:10px;">✅ Cours déverrouillé !</p>
                <video controls width="100%" style="border-radius:10px;max-height:500px;">
                    <source src="${url}" type="video/mp4">
                    Votre navigateur ne supporte pas la vidéo.
                </video>
            </div>
        `;
    }
    else if (isPDF) {
        content.innerHTML = `
            <div class="unlocked-content">
                <p style="color:green;margin-bottom:10px;">✅ Cours déverrouillé !</p>
                <iframe
                    src="${url}"
                    width="100%"
                    height="600px"
                    style="border:none; border-radius:10px;">
                </iframe>
            </div>
        `;
    }
    else if (isExternal) {
        content.innerHTML = `
            <div class="unlocked-content">
                <p style="color:green;margin-bottom:10px;">✅ Cours déverrouillé !</p>
                <a href="${url}" target="_blank">
                    <button class="open-btn">🔗 Ouvrir le cours</button>
                </a>
            </div>
        `;
    }
    else {
        content.innerHTML = `
            <div class="unlocked-content">
                <p style="color:green;margin-bottom:10px;">✅ Cours déverrouillé !</p>
                <button class="open-btn" onclick="window.open('${url}')">
                    ⬇️ Télécharger
                </button>
            </div>
        `;
    }
}

// ========================================
// INITIALISATION ET RAFRAÎCHISSEMENT
// ========================================
document.addEventListener("DOMContentLoaded", function () {
    loadCourses();
    loadPurchases();
    loadQuestions();

    // Rafraîchir les cours toutes les 10 secondes
    setInterval(loadCourses, 10000);

    // Mises à jour en temps réel de Supabase
    if (typeof supabaseClient !== "undefined") {
        supabaseClient
            .channel("courses-dashboard-etudiant")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "courses" },
                function () {
                    loadCourses();
                }
            )
            .subscribe();
    }
});
