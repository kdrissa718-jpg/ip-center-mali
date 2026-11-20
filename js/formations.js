
function actualiserNavigationDescription(description, navigation, precedent, suivant) {
    const defilementMax = Math.max(0, description.scrollHeight - description.clientHeight);
    navigation.hidden = defilementMax <= 1;
    precedent.hidden = defilementMax <= 1 || description.scrollTop <= 1;
    suivant.hidden = defilementMax <= 1 || description.scrollTop >= defilementMax - 1;
}

function defilerDescription(description, direction) {
    const hauteurPage = description.clientHeight;
    const defilementMax = Math.max(0, description.scrollHeight - hauteurPage);
    const destination = Math.min(
        defilementMax,
        Math.max(0, description.scrollTop + direction * hauteurPage)
    );
    description.scrollTo({ top: destination, behavior: "smooth" });
}

async function chargerFormations() {
    const message = document.getElementById("message");
    const conteneur = document.getElementById("formations");
    const recherche = document.getElementById("recherche-cours");
    const formationsInscrites = new Set();

    try {
        if (!window.supabaseClient) {
            throw new Error("Le client Supabase n'est pas initialisé.");
        }

        const { data: sessionData, error: sessionError } =
            await window.supabaseClient.auth.getUser();
        if (sessionError) throw sessionError;
        const utilisateurId = sessionData?.user?.id;
        let utilisateurRole = "";
        if (utilisateurId) {
            const { data: profile } = await window.supabaseClient.from("profiles")
                .select("role").eq("id", utilisateurId).maybeSingle();
            utilisateurRole = profile?.role || "";
            const { data: inscriptions, error: inscriptionError } = await window.supabaseClient
                .from("student_formation_access")
                .select("formation_id")
                .eq("student_id", utilisateurId);
            if (inscriptionError) throw inscriptionError;
            (inscriptions || []).forEach((item) => formationsInscrites.add(String(item.formation_id)));
        }

        const { data, error } = await window.supabaseClient
            .from("formations")
            .select("id, title, categorie, description, prix, couverture_url, pdf_url, youtube_url, video_url, is_open");

        if (error) throw error;

        const playlists = utilisateurId && window.ModalitePlaylist
            ? await window.ModalitePlaylist.load(data || [], window.supabaseClient)
            : new Map();
        (data || []).forEach((formation) => {
            formation.playlist = playlists.get(String(formation.id)) || { courses: [], lessons: [] };
        });

        conteneur.innerHTML = "";
        message.textContent = "";

        if (!data || data.length === 0) {
            message.textContent =
                "Aucune formation n'est disponible pour le moment.";
            return;
        }

        const formationsChargees = [];
        const categoriesPrioritaires = [
            "Réseau informatique",
            "Programmation informatique",
            "Maintenance informatique",
            "Pack Office",
            "Intelligence artificielle",
            "Caméra de surveillance",
            "Robotique"
        ];
        const normaliserCategorie = (valeur) => String(valeur || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("fr")
            .trim();
        const nomCategorie = (formation) => {
            const valeur = formation.categorie || formation.category ||
                formation.domaine || formation.categorie_formation;
            if (!valeur) return "Autres cours";
            const cle = normaliserCategorie(valeur);
            const connue = categoriesPrioritaires.find((categorie) =>
                normaliserCategorie(categorie) === cle
            );
            return connue || String(valeur).trim();
        };

        data.forEach((formation) => {
            const carte = document.createElement("article");
            const isOpen = formation.is_open !== false;
            carte.className = `formation${isOpen ? "" : " is-closed"}`;
            let actualiserNavigation = () => {};
            formationsChargees.push({ carte, formation, categorie: nomCategorie(formation) });

            // Compatibilité avec les colonnes title et titre.
            const nomFormation =
                formation.title || formation.titre || "Formation";

            // Titre
            const titre = document.createElement("h2");
            titre.textContent = nomFormation;
            carte.appendChild(titre);

            if (!isOpen) {
                const badgeFermee = document.createElement("p");
                badgeFermee.className = "formation-fermee-badge";
                badgeFermee.textContent = "Fermée par l’administration";
                carte.appendChild(badgeFermee);
            }

            // Image de couverture
            if (formation.couverture_url) {
                const image = document.createElement("img");
                image.src = formation.couverture_url;
                image.alt = `Couverture : ${nomFormation}`;
                image.loading = "lazy";
                image.className = "formation-couverture";
                image.tabIndex = 0;
                image.setAttribute("role", "button");
                image.setAttribute("aria-expanded", "false");
                image.setAttribute("aria-label", `Afficher les détails de ${nomFormation}`);
                carte.appendChild(image);
            }

            // Description parcourue par pages de cinq lignes.
            if (formation.description) {
                const blocDescription = document.createElement("div");
                blocDescription.className = "bloc-description";

                const description = document.createElement("p");
                description.className = "description-texte";
                description.textContent = formation.description;

                blocDescription.appendChild(description);

                const navigationDescription = document.createElement("div");
                navigationDescription.className = "navigation-description";
                navigationDescription.setAttribute("role", "group");
                navigationDescription.setAttribute(
                    "aria-label",
                    "Navigation dans la description"
                );
                const boutonPrecedent = document.createElement("button");
                boutonPrecedent.type = "button";
                boutonPrecedent.className = "bouton-description";
                boutonPrecedent.textContent = "Précédent";
                boutonPrecedent.hidden = true;
                const boutonSuivant = document.createElement("button");
                boutonSuivant.type = "button";
                boutonSuivant.className = "bouton-description";
                boutonSuivant.textContent = "Suivant";
                navigationDescription.append(boutonPrecedent, boutonSuivant);
                blocDescription.appendChild(navigationDescription);
                actualiserNavigation = () => actualiserNavigationDescription(
                    description,
                    navigationDescription,
                    boutonPrecedent,
                    boutonSuivant
                );
                description.addEventListener("scroll", actualiserNavigation, { passive: true });
                boutonPrecedent.addEventListener("click", () =>
                    defilerDescription(description, -1)
                );
                boutonSuivant.addEventListener("click", () =>
                    defilerDescription(description, 1)
                );
                carte.appendChild(blocDescription);
            }

            // Prix
            if (
                formation.prix !== null &&
                formation.prix !== undefined &&
                formation.prix !== ""
            ) {
                const prix = document.createElement("p");
                prix.className = "formation-prix";

                prix.textContent =
                    Number(formation.prix).toLocaleString("fr-FR") +
                    " FCFA";

                carte.appendChild(prix);
            }

            const blocDescription = carte.querySelector(".bloc-description");
            const etapeDescription = document.createElement("div");
            etapeDescription.className = "etape-formation etape-description";
            etapeDescription.setAttribute("aria-label", "Détails de la formation");

            const indicateur = document.createElement("p");
            indicateur.className = "indicateur-etape";
            indicateur.textContent = "Description de la formation";
            etapeDescription.appendChild(indicateur);
            if (blocDescription) etapeDescription.appendChild(blocDescription);

            if (formation.pdf_url) {
                const pdf = document.createElement("a");
                pdf.href = formation.pdf_url;
                pdf.textContent = "📄 Consulter le support PDF";
                pdf.target = "_blank";
                pdf.rel = "noopener noreferrer";
                pdf.className = "formation-pdf";
                etapeDescription.appendChild(pdf);
            }

            if (utilisateurRole === "student" && window.ModalitePlaylist) {
                const playlist = document.createElement("div");
                playlist.innerHTML = window.ModalitePlaylist.render(formation, { student: true });
                etapeDescription.appendChild(playlist);
            }

            const boutonInscription = document.createElement("button");
            boutonInscription.type = "button";
            boutonInscription.className = "bouton-etape bouton-inscription";
            const idFormation = String(formation.id);
            boutonInscription.disabled = !isOpen;
            boutonInscription.textContent = formationsInscrites.has(idFormation)
                ? "Poursuivre la formation"
                : "S'inscrire à la formation";
            boutonInscription.addEventListener("click", async () => {
                boutonInscription.disabled = true;
                try {
                    const { data: authData, error: authError } =
                        await window.supabaseClient.auth.getUser();
                    if (authError) throw authError;
                    const utilisateur = authData?.user;
                    if (!utilisateur) {
                        window.location.href = `login.html?formation=${encodeURIComponent(idFormation)}`;
                        return;
                    }
                    if (!formationsInscrites.has(idFormation)) {
                        const { error: inscriptionError } = await window.supabaseClient
                            .from("student_formation_access")
                            .upsert({ student_id: utilisateur.id, formation_id: idFormation }, {
                                onConflict: "student_id,formation_id"
                            });
                        if (inscriptionError) throw inscriptionError;
                        formationsInscrites.add(idFormation);
                    }
                    const destination = new URL("parcours-formation.html", window.location.href);
                    destination.searchParams.set("formation", idFormation);
                    window.location.href = destination.href;
                } catch (error) {
                    console.error("Inscription à la formation impossible :", error);
                    alert("Impossible d'enregistrer l'inscription. Vérifie les permissions Supabase et réessaie.");
                    boutonInscription.disabled = false;
                }
            });
            etapeDescription.appendChild(boutonInscription);

            carte.appendChild(etapeDescription);
            etapeDescription.hidden = true;

            const afficherDescription = () => {
                carte.classList.add("details-ouverts");
                etapeDescription.hidden = false;
                requestAnimationFrame(actualiserNavigation);
                const couverture = carte.querySelector(".formation-couverture");
                if (couverture) couverture.setAttribute("aria-expanded", "true");
            };

            const couverture = carte.querySelector(".formation-couverture");
            if (couverture) {
                couverture.addEventListener("click", afficherDescription);
                couverture.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        afficherDescription();
                    }
                });
            }

        });

        const groupes = new Map();
        formationsChargees.forEach(({ carte, categorie }) => {
            if (!groupes.has(categorie)) groupes.set(categorie, []);
            groupes.get(categorie).push(carte);
        });

        const ordreCategorie = (a, b) => {
            const indexA = categoriesPrioritaires.indexOf(a);
            const indexB = categoriesPrioritaires.indexOf(b);
            if (indexA !== -1 || indexB !== -1) {
                return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) -
                    (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
            }
            if (a === "Autres cours") return 1;
            if (b === "Autres cours") return -1;
            return a.localeCompare(b, "fr");
        };

        [...groupes.entries()].sort(([a], [b]) => ordreCategorie(a, b))
            .forEach(([categorie, cartes]) => {
                const section = document.createElement("details");
                section.className = "groupe-categorie modalite-group";
                const titreCategorie = document.createElement("summary");
                titreCategorie.className = "titre-categorie";
                titreCategorie.textContent = categorie;
                const grille = document.createElement("div");
                grille.className = "grille-categorie modalite-group-content";
                cartes.forEach((carte) => grille.appendChild(carte));
                section.append(titreCategorie, grille);
                conteneur.appendChild(section);
            });

        if (recherche) {
            recherche.addEventListener("input", () => {
                const terme = recherche.value.trim().toLocaleLowerCase("fr");
                let nombreVisible = 0;
                formationsChargees.forEach(({ carte, formation }) => {
                    const texte = [formation.title, formation.titre, formation.description]
                        .filter(Boolean).join(" ").toLocaleLowerCase("fr");
                    const visible = texte.includes(terme);
                    carte.hidden = !visible;
                    if (visible) nombreVisible++;
                });
                conteneur.querySelectorAll(".groupe-categorie").forEach((section) => {
                    section.hidden = !section.querySelector(".formation:not([hidden])");
                });
                message.textContent = nombreVisible ? "" : "Aucun cours ne correspond à votre recherche.";
            });
        }

        conteneur.addEventListener("click", async (event) => {
            const link = event.target.closest("[data-playlist-formation]");
            if (!link) return;
            event.preventDefault();
            try {
                const userResult = await window.supabaseClient.auth.getUser();
                const user = userResult.data?.user;
                if (!user) {
                    window.location.href = `login.html?formation=${encodeURIComponent(link.dataset.playlistFormation)}`;
                    return;
                }
                const { error: accessError } = await window.supabaseClient.from("student_formation_access")
                    .upsert({ student_id: user.id, formation_id: link.dataset.playlistFormation }, { onConflict: "student_id,formation_id" });
                if (accessError) throw accessError;
                const destination = new URL("parcours-formation.html", window.location.href);
                destination.searchParams.set("formation", link.dataset.playlistFormation);
                destination.searchParams.set("lesson", link.dataset.playlistLesson);
                window.location.href = destination.href;
            } catch (playlistError) {
                console.error("Ouverture de la playlist impossible :", playlistError);
                alert(playlistError.message || "Impossible d’ouvrir cette étape.");
            }
        });
    } catch (error) {
        console.error("Erreur Supabase :", error);
        message.textContent =
            "Erreur lors du chargement des formations. Vérifiez la connexion et les autorisations Supabase.";
    }
}

chargerFormations();
