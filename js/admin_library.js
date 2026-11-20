"use strict";

(() => {
    const BUCKET = "library-files";
    const MAX_MEDIA_SIZE = 100 * 1024 * 1024;
    const MAX_COVER_SIZE = 5 * 1024 * 1024;
    const form = document.getElementById("adminLibraryForm");
    const list = document.getElementById("adminLibraryList");
    const feedback = document.getElementById("adminLibraryFeedback");
    let adminUser = null;
    let resources = [];

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        })[character]);
    }

    function setFeedback(message, isError = false) {
        feedback.textContent = message;
        feedback.classList.toggle("is-error", isError);
        feedback.classList.toggle("is-success", Boolean(message) && !isError);
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ""));
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch {
            return "";
        }
    }

    function filePath(file, kind) {
        const safeName = file.name.normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(-120);
        const randomId = window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${adminUser.id}/${kind}/${randomId}-${safeName}`;
    }

    async function uploadFile(client, file, kind, maxSize) {
        if (!file) return null;
        if (file.size > maxSize) throw new Error(`Le fichier ${file.name} dépasse la taille maximale autorisée.`);
        const path = filePath(file, kind);
        const { error } = await client.storage.from(BUCKET).upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false
        });
        if (error) throw error;
        return path;
    }

    function validateResourceFile(type, file) {
        if (!file) return;
        const mime = String(file.type || "").toLowerCase();
        if (["PDF", "Livre"].includes(type) && mime !== "application/pdf") {
            throw new Error("Pour un PDF ou un livre, choisissez un fichier PDF.");
        }
        if (type === "Audio" && !mime.startsWith("audio/")) {
            throw new Error("Choisissez un fichier audio.");
        }
        if (type === "Vidéo" && !mime.startsWith("video/")) {
            throw new Error("Choisissez un fichier vidéo.");
        }
        if (type === "Lien" && !["application/pdf", "audio/", "video/"].some((allowed) =>
            allowed.endsWith("/") ? mime.startsWith(allowed) : mime === allowed
        )) {
            throw new Error("Le fichier doit être un PDF, un audio ou une vidéo.");
        }
    }

    async function signedUrl(client, path) {
        if (!path) return "";
        const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
        if (error) throw error;
        return data?.signedUrl || "";
    }

    async function loadResources() {
        const client = window.supabaseClient;
        const { data, error } = await client.from("library_resources")
            .select("id, title, author, category, description, resource_type, file_path, external_url, cover_path, cover_url, created_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        resources = await Promise.all((data || []).map(async (resource) => ({
            ...resource,
            file_signed_url: await signedUrl(client, resource.file_path),
            cover_signed_url: await signedUrl(client, resource.cover_path)
        })));
        renderResources();
    }

    function renderResources() {
        if (!resources.length) {
            list.innerHTML = '<p class="empty-state">Aucune ressource dans la bibliothèque.</p>';
            return;
        }
        list.innerHTML = resources.map((resource) => {
            const cover = resource.cover_signed_url || safeUrl(resource.cover_url);
            const mediaUrl = resource.file_signed_url || safeUrl(resource.external_url);
            let media = "";
            if (resource.file_signed_url && resource.resource_type === "Audio") {
                media = `<audio controls preload="none" src="${escape(resource.file_signed_url)}"></audio>`;
            } else if (resource.file_signed_url && resource.resource_type === "Vidéo") {
                media = `<video controls preload="metadata" src="${escape(resource.file_signed_url)}"></video>`;
            }
            return `
                <article class="admin-library-item">
                    ${cover ? `<img src="${escape(cover)}" alt="Couverture de ${escape(resource.title)}" loading="lazy">` : ""}
                    <span class="badge status">${escape(resource.resource_type)}</span>
                    <h3>${escape(resource.title)}</h3>
                    <p>${escape([resource.category, resource.author].filter(Boolean).join(" · "))}</p>
                    ${resource.description ? `<p>${escape(resource.description)}</p>` : ""}
                    ${media}
                    ${mediaUrl && !media ? `<p><a href="${escape(mediaUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la ressource</a></p>` : ""}
                    <button class="icon-btn danger" type="button" data-library-delete="${escape(resource.id)}"><i class="fas fa-trash" aria-hidden="true"></i> Supprimer</button>
                </article>
            `;
        }).join("");
    }

    async function submitResource(event) {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);
        const resourceType = String(formData.get("resource_type") || "");
        const rawFile = formData.get("resource_file");
        const rawCoverFile = formData.get("cover_file");
        const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
        const coverFile = rawCoverFile instanceof File && rawCoverFile.size > 0 ? rawCoverFile : null;
        const externalUrl = safeUrl(String(formData.get("external_url") || "").trim());
        const coverUrl = safeUrl(String(formData.get("cover_url") || "").trim());
        let filePathValue = "";
        let coverPathValue = "";
        let saved = false;
        const client = window.supabaseClient;

        if (!String(formData.get("title") || "").trim()) {
            setFeedback("Le titre est obligatoire.", true);
            return;
        }
        try {
            validateResourceFile(resourceType, file);
            if (coverFile && (!coverFile.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(coverFile.type))) {
                throw new Error("La couverture doit être une image JPG, PNG ou WebP.");
            }
            if (coverFile && coverFile.size > MAX_COVER_SIZE) throw new Error("La couverture dépasse 5 Mo.");
            if (!file && !externalUrl) throw new Error("Ajoutez un fichier ou un lien externe.");
            if (["PDF", "Livre", "Audio", "Vidéo"].includes(resourceType) && !file && !externalUrl) {
                throw new Error("Ajoutez un fichier ou un lien correspondant au type choisi.");
            }
            if (resourceType === "Lien" && !externalUrl && !file) throw new Error("Ajoutez un lien ou un fichier.");
        } catch (error) {
            setFeedback(error.message, true);
            return;
        }

        button.disabled = true;
        setFeedback("Envoi des fichiers et enregistrement...");
        try {
            filePathValue = await uploadFile(client, file, "resources", MAX_MEDIA_SIZE) || "";
            coverPathValue = await uploadFile(client, coverFile, "covers", MAX_COVER_SIZE) || "";
            const { error } = await client.from("library_resources").insert({
                title: String(formData.get("title")).trim(),
                author: String(formData.get("author") || "").trim(),
                category: String(formData.get("category") || "").trim() || "Autres",
                description: String(formData.get("description") || "").trim(),
                resource_type: resourceType,
                file_path: filePathValue || null,
                external_url: externalUrl || null,
                cover_path: coverPathValue || null,
                cover_url: coverUrl || null,
                created_by: adminUser.id
            });
            if (error) throw error;
            saved = true;
            form.reset();
            setFeedback("Ressource ajoutée à la bibliothèque.");
            await loadResources();
        } catch (error) {
            if (!saved && (filePathValue || coverPathValue)) {
                const paths = [filePathValue, coverPathValue].filter(Boolean);
                const { error: cleanupError } = await client.storage.from(BUCKET).remove(paths);
                if (cleanupError) console.error("Nettoyage des fichiers interrompu :", cleanupError);
            }
            console.error("Ajout de ressource impossible :", error);
            setFeedback(error.message || "Impossible d’ajouter la ressource.", true);
        } finally {
            button.disabled = false;
        }
    }

    async function deleteResource(button) {
        const resource = resources.find((item) => String(item.id) === button.dataset.libraryDelete);
        if (!resource || !window.confirm(`Supprimer « ${resource.title} » de la bibliothèque ?`)) return;
        button.disabled = true;
        const client = window.supabaseClient;
        try {
            const { error } = await client.from("library_resources").delete().eq("id", resource.id);
            if (error) throw error;
            resources = resources.filter((item) => String(item.id) !== String(resource.id));
            renderResources();
            const paths = [resource.file_path, resource.cover_path].filter(Boolean);
            if (paths.length) {
                const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
                if (storageError) console.error("La ressource est supprimée, mais un fichier reste dans Storage :", storageError);
            }
            setFeedback("Ressource supprimée.");
        } catch (error) {
            console.error("Suppression de ressource impossible :", error);
            setFeedback(error.message || "Impossible de supprimer la ressource.", true);
            button.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", async () => {
        form.addEventListener("submit", submitResource);
        list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-library-delete]");
            if (button) deleteResource(button);
        });
        document.getElementById("refreshAdminLibrary").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await loadResources();
                setFeedback("Bibliothèque actualisée.");
            } catch (error) {
                setFeedback(error.message || "Impossible d’actualiser la bibliothèque.", true);
            } finally {
                button.disabled = false;
            }
        });

        try {
            const client = window.supabaseClient;
            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData?.user) throw new Error("Session administrateur absente.");
            const { data: profile, error: profileError } = await client.from("profiles")
                .select("role, status").eq("id", authData.user.id).maybeSingle();
            if (profileError) throw profileError;
            const role = authData.user.app_metadata?.role === "admin" ? "admin" : profile?.role;
            if (role !== "admin" || profile?.status !== "Actif") throw new Error("Accès réservé à un administrateur actif.");
            adminUser = authData.user;
            await loadResources();
        } catch (error) {
            console.error("Initialisation de la gestion de bibliothèque impossible :", error);
            setFeedback(error.message || "Impossible de charger la bibliothèque.", true);
            list.textContent = error.message || "Impossible de charger la bibliothèque.";
        }
    });
})();
