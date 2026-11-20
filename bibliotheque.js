"use strict";

const LIBRARY_BUCKET = "library-files";
const SIGNED_URL_SECONDS = 3600;
let libraryResources = [];
let currentUser = null;
let currentProfile = null;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
}

function safeHttpUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function setLibraryFeedback(message, isError = false) {
    const feedback = document.getElementById("libraryFeedback");
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
}

function setAccountLabel() {
    const label = document.getElementById("accountLabel");
    const link = document.getElementById("accountLink");
    if (!label || !link) return;
    label.textContent = currentProfile?.full_name || currentUser?.email || "Mon espace";
    link.href = currentProfile?.role === "admin" ? "dashboard_admin.html"
        : currentProfile?.role === "teacher" ? "dashboard_professeur.html"
            : "dashboard_etudient.html";
}

async function verifySession() {
    const client = window.supabaseClient;
    if (!client) throw new Error("Client Supabase indisponible.");
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session) {
        window.location.replace("login.html?next=bibliotheque.html");
        return false;
    }
    const { data, error } = await client.auth.getUser();
    if (error?.name === "AuthSessionMissingError" || !data?.user) {
        window.location.replace("login.html?next=bibliotheque.html");
        return false;
    }
    if (error) throw error;
    currentUser = data.user;
    const { data: profile, error: profileError } = await client.from("profiles")
        .select("full_name, role, status").eq("id", currentUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.status !== "Actif") {
        await client.auth.signOut();
        window.location.replace("login.html");
        return false;
    }
    currentProfile = {
        ...profile,
        role: currentUser.app_metadata?.role === "admin" ? "admin" : profile.role
    };
    setAccountLabel();
    return true;
}

async function signedUrl(client, path) {
    if (!path) return "";
    const { data, error } = await client.storage.from(LIBRARY_BUCKET)
        .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error) throw error;
    return data?.signedUrl || "";
}

async function loadLibrary() {
    const client = window.supabaseClient;
    const { data, error } = await client.from("library_resources")
        .select("id, title, author, category, description, resource_type, file_path, external_url, cover_path, cover_url, created_at")
        .order("created_at", { ascending: false });
    if (error) throw error;

    libraryResources = await Promise.all((data || []).map(async (resource) => ({
        ...resource,
        fileUrl: await signedUrl(client, resource.file_path),
        coverUrl: await signedUrl(client, resource.cover_path) || safeHttpUrl(resource.cover_url),
        searchable: [resource.title, resource.author, resource.category, resource.description, resource.resource_type]
            .join(" ").toLocaleLowerCase("fr")
    })));
    renderCategoryOptions();
    renderLibrary();
}

function renderCategoryOptions() {
    const select = document.getElementById("categoryFilter");
    const selected = select.value;
    const categories = [...new Set(libraryResources.map((resource) => resource.category).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "fr"));
    select.innerHTML = '<option value="">Toutes les catégories</option>' +
        categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    if (categories.includes(selected)) select.value = selected;
}

function renderLibrary() {
    const container = document.getElementById("libraryGrid");
    const search = document.getElementById("librarySearch").value.trim().toLocaleLowerCase("fr");
    const category = document.getElementById("categoryFilter").value;
    const type = document.getElementById("typeFilter").value;
    const filtered = libraryResources.filter((resource) =>
        (!search || resource.searchable.includes(search)) &&
        (!category || resource.category === category) &&
        (!type || resource.resource_type === type)
    );

    document.getElementById("resourceCount").textContent = String(libraryResources.length);
    document.getElementById("documentCount").textContent = String(libraryResources.filter((item) =>
        ["PDF", "Livre"].includes(item.resource_type)
    ).length);
    document.getElementById("videoCount").textContent = String(libraryResources.filter((item) =>
        ["Audio", "Vidéo"].includes(item.resource_type)
    ).length);

    if (!filtered.length) {
        container.innerHTML = `<div class="library-empty"><i class="fa-solid fa-book-open" aria-hidden="true"></i>${
            libraryResources.length ? "Aucune ressource ne correspond à votre recherche." : "La bibliothèque est vide pour le moment."
        }</div>`;
        return;
    }

    container.innerHTML = filtered.map((resource) => {
        const cover = resource.coverUrl
            ? `<div class="resource-cover"><img src="${escapeHtml(resource.coverUrl)}" alt="Couverture de ${escapeHtml(resource.title)}" loading="lazy"></div>`
            : `<div class="resource-cover" aria-hidden="true"><i class="${resource.resource_type === "Vidéo" ? "fa-solid fa-circle-play" : resource.resource_type === "Audio" ? "fa-solid fa-headphones" : resource.resource_type === "Livre" ? "fa-solid fa-book" : "fa-regular fa-file-lines"}"></i></div>`;
        const fileAction = resource.fileUrl && resource.resource_type === "Audio"
            ? `<audio class="library-resource-media" controls preload="none" src="${escapeHtml(resource.fileUrl)}"></audio>`
            : resource.fileUrl && resource.resource_type === "Vidéo"
                ? `<video class="library-resource-media" controls preload="metadata" src="${escapeHtml(resource.fileUrl)}"></video>`
                : resource.fileUrl
                    ? `<a class="resource-link" href="${escapeHtml(resource.fileUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-file-pdf" aria-hidden="true"></i>${resource.resource_type === "Livre" ? "Ouvrir le livre" : `Ouvrir ${escapeHtml(resource.resource_type.toLowerCase())}`}</a>`
                    : "";
        const external = safeHttpUrl(resource.external_url)
            ? `<a class="resource-link" href="${escapeHtml(safeHttpUrl(resource.external_url))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Ouvrir le lien</a>`
            : "";
        return `
            <article class="resource-card">
                ${cover}
                <div class="resource-content">
                    <div class="resource-labels"><span class="resource-badge">${escapeHtml(resource.resource_type)}</span><span class="resource-badge is-manual">Bibliothèque</span></div>
                    <h3>${escapeHtml(resource.title)}</h3>
                    <p class="resource-byline">${escapeHtml([resource.category, resource.author].filter(Boolean).join(" · "))}</p>
                    ${resource.description ? `<p class="resource-description">${escapeHtml(resource.description)}</p>` : ""}
                    <div class="resource-actions">${fileAction}${external}${!fileAction && !external ? '<span class="resource-byline">Aucun fichier ou lien disponible.</span>' : ""}</div>
                </div>
            </article>
        `;
    }).join("");
}

async function actualiserBibliotheque() {
    const button = document.getElementById("refreshLibrary");
    button.disabled = true;
    setLibraryFeedback("Actualisation de la bibliothèque...");
    try {
        await loadLibrary();
        setLibraryFeedback(`${libraryResources.length} ressource(s) chargée(s).`);
    } catch (error) {
        console.error("Chargement de la bibliothèque impossible :", error);
        setLibraryFeedback("Impossible de charger la bibliothèque. Vérifiez le SQL Supabase et réessayez.", true);
    } finally {
        button.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("librarySearch").addEventListener("input", renderLibrary);
    document.getElementById("categoryFilter").addEventListener("change", renderLibrary);
    document.getElementById("typeFilter").addEventListener("change", renderLibrary);
    document.getElementById("refreshLibrary").addEventListener("click", actualiserBibliotheque);
    try {
        if (!await verifySession()) return;
        await loadLibrary();
        setLibraryFeedback(`${libraryResources.length} ressource(s) chargée(s).`);
    } catch (error) {
        console.error("Initialisation de la bibliothèque impossible :", error);
        setLibraryFeedback("Impossible de charger la bibliothèque. Vérifiez le SQL Supabase et réessayez.", true);
        document.getElementById("libraryGrid").innerHTML =
            '<div class="library-empty">Une erreur est survenue pendant le chargement.</div>';
    }
});
